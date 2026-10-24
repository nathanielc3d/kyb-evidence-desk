import { describe, expect } from 'bun:test'
import { TxStatus } from '@chainlink/cre-sdk'
import { EvmMock, HttpActionsMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import { decodeAbiParameters, parseAbiParameters } from 'viem'
import { buildQueryUrl, encodeAttestation, fetchAttestation, onKybRequest, type Config } from './workflow'

const CHAIN_SELECTOR = 16015286601757825753n // ethereum-testnet-sepolia
const config: Config = {
	apiBase: 'https://kyb-evidence-desk.moneymachine.workers.dev',
	evms: [{ registryAddress: '0x000000000000000000000000000000000000dEaD', chainSelectorName: 'ethereum-testnet-sepolia', gasLimit: '300000' }],
}
const ATT = {
	schema: 'kyb-evidence-report/1',
	subject_id: '0xee5b6cee6ddd89585d8f5a7a800786481de6107ddf97db08166da7ea42cfde0d',
	attestation_hash: '0xd5de096e21663a876a5b6e54d46d87cb648b0f6b47c0c722e83a9e75de4483a4',
	decision: 'pass',
	decision_code: 0,
	day: '2026-10-24',
	rules_version: '2026-10-24.1',
}
const requester = (body: unknown, statusCode = 200) =>
	({ sendRequest: () => ({ result: () => ({ statusCode, body: Buffer.from(JSON.stringify(body)) }) }) }) as any

describe('pure helpers', () => {
	test('buildQueryUrl encodes all fields and trims the trailing slash', () => {
		expect(buildQueryUrl('https://a.dev/', { vat: 'FR39356000000', iban: 'FR76 3000', name: 'La Poste' })).toBe(
			'https://a.dev/api/attestation?vat=FR39356000000&iban=FR76+3000&name=La+Poste',
		)
	})
	test('fetchAttestation parses a good response', () => {
		const a = fetchAttestation(requester(ATT), config, { vat: 'FR39356000000' })
		expect(a).toEqual({ subjectId: ATT.subject_id, attestationHash: ATT.attestation_hash, decisionCode: 0, day: 20261024, rulesVersion: '2026-10-24.1' })
	})
	test('fetchAttestation fails closed on HTTP errors and malformed bodies', () => {
		expect(() => fetchAttestation(requester({ error: 'x' }, 502), config, { vat: 'FR1' })).toThrow('HTTP 502')
		expect(() => fetchAttestation(requester({ ...ATT, schema: 'other' }), config, { vat: 'FR1' })).toThrow('schema')
		expect(() => fetchAttestation(requester({ ...ATT, attestation_hash: '0x12' }), config, { vat: 'FR1' })).toThrow('hashes')
		expect(() => fetchAttestation(requester({ ...ATT, decision_code: 7 }), config, { vat: 'FR1' })).toThrow('decision')
	})
	test('encodeAttestation round-trips through the ABI the registry decodes', () => {
		const a = fetchAttestation(requester({ ...ATT, decision_code: 1 }), config, { vat: 'FR1' })
		const [s, h, d, day] = decodeAbiParameters(parseAbiParameters('bytes32, bytes32, uint8, uint32'), encodeAttestation(a))
		expect([s, h, d, day]).toEqual([ATT.subject_id, ATT.attestation_hash, 1, 20261024])
	})
})

describe('onKybRequest (full workflow with mocked capabilities)', () => {
	test('fetches, reaches consensus, signs and writes the report', () => {
		const http = HttpActionsMock.testInstance()
		let calledUrl = ''
		http.sendRequest = (req: any) => {
			calledUrl = req.url
			return { statusCode: 200, body: Buffer.from(JSON.stringify(ATT)) } as any
		}
		const evm = EvmMock.testInstance(CHAIN_SELECTOR)
		let wrote = false
		evm.writeReport = () => {
			wrote = true
			return { txStatus: TxStatus.SUCCESS, txHash: new Uint8Array(32).fill(0xab) } as any
		}
		const runtime = newTestRuntime(undefined, { config } as any) as any
		runtime.config = config
		const out = JSON.parse(onKybRequest(runtime, { input: Buffer.from(JSON.stringify({ vat: 'FR39356000000', name: 'La Poste' })) } as any))
		expect(calledUrl).toContain('/api/attestation?vat=FR39356000000&name=La+Poste')
		expect(wrote).toBe(true)
		expect(out.decision).toBe('pass')
		expect(out.attestationHash).toBe(ATT.attestation_hash)
		expect(out.txHash).toBe('0x' + 'ab'.repeat(32))
	})
	test('rejects an empty or invalid trigger payload', () => {
		const runtime = newTestRuntime() as any
		runtime.config = config
		expect(() => onKybRequest(runtime, { input: new Uint8Array() } as any)).toThrow('payload is required')
		expect(() => onKybRequest(runtime, { input: Buffer.from('{"vat":"x"}') } as any)).toThrow()
	})
})
