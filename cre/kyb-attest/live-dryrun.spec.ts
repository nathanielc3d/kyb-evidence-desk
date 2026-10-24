// Local dry run of the CRE workflow against the LIVE KYB Evidence Desk API (opt-in: LIVE=1).
// Not the official `cre workflow simulate` (that one needs `cre login`). It uses the CRE SDK test
// harness: emulates N DON nodes by fetching the live attestation N times, checks they are
// byte-identical (what the `identical` aggregation enforces), then runs onKybRequest with the
// live body and a mocked EVM write, printing the exact ABI payload sent to the registry.
// Usage: LIVE=1 PAYLOAD=./http_trigger_payload.ie.json NODES=4 bun test live-dryrun.spec.ts
import { describe, expect } from 'bun:test'
import { TxStatus } from '@chainlink/cre-sdk'
import { EvmMock, HttpActionsMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import { readFileSync } from 'node:fs'
import { buildQueryUrl, encodeAttestation, fetchAttestation, onKybRequest, type Config } from './workflow'

const LIVE = process.env.LIVE === '1'
const CHAIN_SELECTOR = 16015286601757825753n // ethereum-testnet-sepolia
const log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`)
const mask = (u: string) => u.replace(/iban=([A-Z]{2}\d{2})[^&]*/, 'iban=$1…')

describe.skipIf(!LIVE)('live dry run (LIVE=1)', () => {
	test('N nodes agree, consensus reached, report encoded and written (EVM mocked)', async () => {
		const config: Config = JSON.parse(readFileSync('./config.staging.json', 'utf-8'))
		const payload = JSON.parse(readFileSync(process.env.PAYLOAD || './http_trigger_payload.json', 'utf-8'))
		const nodes = Number(process.env.NODES || 4)
		const url = buildQueryUrl(config.apiBase, payload)
		log(`HTTP trigger payload: vat=${payload.vat} name=${payload.name ?? '-'} iban=${payload.iban ? payload.iban.slice(0, 4) + '…' : '-'}`)
		log(`emulating ${nodes} DON nodes, each: GET ${mask(url)}`)
		const bodies: string[] = []
		for (let i = 0; i < nodes; i++) {
			const r = await fetch(url)
			const b = await r.text()
			bodies.push(b)
			const d = JSON.parse(b)
			log(`node ${i + 1}: HTTP ${r.status} decision=${d.decision} attestation=${d.attestation_hash}`)
		}
		const agree = bodies.every((b) => b === bodies[0])
		log(agree ? 'identical aggregation: all nodes agree byte-for-byte -> consensus reached'
			: 'identical aggregation: NODES DISAGREE -> consensus fails, nothing is written (fail closed)')
		expect(agree).toBe(true)

		const http = HttpActionsMock.testInstance()
		http.sendRequest = () => ({ statusCode: 200, body: Buffer.from(bodies[0]) }) as any
		const evm = EvmMock.testInstance(CHAIN_SELECTOR)
		let receiver = ''
		evm.writeReport = (req: any) => {
			receiver = typeof req.receiver === 'string' ? req.receiver : '0x' + Buffer.from(req.receiver).toString('hex')
			log(`EVMClient.writeReport -> receiver ${receiver}, gasLimit ${req.gasConfig?.gasLimit}`)
			return { txStatus: TxStatus.SUCCESS, txHash: new Uint8Array(32).fill(0xab) } as any
		}
		const att = fetchAttestation({ sendRequest: () => ({ result: () => ({ statusCode: 200, body: Buffer.from(bodies[0]) }) }) } as any, config, payload)
		log(`report payload abi.encode(subjectId, attestationHash, decision, day) = ${encodeAttestation(att)}`)
		const runtime = newTestRuntime(undefined, { config } as any) as any
		runtime.config = config
		const out = JSON.parse(onKybRequest(runtime, { input: Buffer.from(JSON.stringify(payload)) } as any))
		log(`workflow result: ${JSON.stringify(out)}`)
		log('dry run OK (EVM write mocked: tx hash 0xabab… is a placeholder, no chain transaction)')
		expect(receiver.toLowerCase()).toBe(config.evms[0].registryAddress.toLowerCase())
		expect(out.attestationHash).toBe(att.attestationHash)
	}, 120000)
})
