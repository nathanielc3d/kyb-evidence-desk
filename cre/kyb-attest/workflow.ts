// Chainlink CRE workflow: KYB attestation.
// HTTP trigger {vat, iban?, name?} -> every DON node fetches the KYB Evidence Desk attestation
// (live EU VIES + IBAN + name checks) -> nodes must agree byte-for-byte (identical aggregation)
// -> DON-signed report (subjectId, attestationHash, decision, day) -> written to KybAttestationRegistry.
import {
	bytesToHex,
	ConsensusAggregationByFields,
	cre,
	EVMClient,
	getNetwork,
	type HTTPPayload,
	type HTTPSendRequester,
	hexToBase64,
	identical,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters } from 'viem'
import { z } from 'zod'

export const configSchema = z.object({
	// No z.string().url(): the CRE WASM runtime has no global URL, so validate with a regex.
	apiBase: z.string().regex(/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i, 'apiBase must be an https URL'),
	evms: z.array(
		z.object({
			registryAddress: z.string(),
			chainSelectorName: z.string(),
			gasLimit: z.string(),
		}),
	),
})
export type Config = z.infer<typeof configSchema>

export const requestSchema = z.object({
	vat: z.string().min(4).max(20),
	iban: z.string().max(42).optional(),
	name: z.string().min(2).max(200).optional(),
})
export type KybRequest = z.infer<typeof requestSchema>

export type Attestation = {
	subjectId: string
	attestationHash: string
	decisionCode: number
	day: number
	rulesVersion: string
}

export const DECISIONS = ['pass', 'review', 'fail'] as const

export const buildQueryUrl = (apiBase: string, req: KybRequest): string => {
	// No URLSearchParams in the CRE WASM runtime: form-encode by hand (same output as URLSearchParams).
	const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, '+').replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
	const parts = [`vat=${enc(req.vat)}`]
	if (req.iban) parts.push(`iban=${enc(req.iban)}`)
	if (req.name) parts.push(`name=${enc(req.name)}`)
	return `${apiBase.replace(/\/$/, '')}/api/attestation?${parts.join('&')}`
}

const HEX32 = /^0x[0-9a-f]{64}$/

/** Runs on each node: one HTTP call, strict parsing. Throws on anything unexpected (fail closed). */
export const fetchAttestation = (sendRequester: HTTPSendRequester, config: Config, req: KybRequest): Attestation => {
	const response = sendRequester.sendRequest({ method: 'GET', url: buildQueryUrl(config.apiBase, req) }).result()
	if (response.statusCode !== 200) throw new Error(`KYB API returned HTTP ${response.statusCode}`)
	const d = JSON.parse(Buffer.from(response.body).toString('utf-8'))
	if (d.schema !== 'kyb-evidence-report/1') throw new Error(`unexpected schema ${d.schema}`)
	if (!HEX32.test(d.subject_id) || !HEX32.test(d.attestation_hash)) throw new Error('malformed hashes')
	if (![0, 1, 2].includes(d.decision_code)) throw new Error('malformed decision')
	if (!/^\d{4}-\d{2}-\d{2}$/.test(d.day)) throw new Error('malformed day')
	return {
		subjectId: d.subject_id,
		attestationHash: d.attestation_hash,
		decisionCode: d.decision_code,
		day: Number(d.day.replace(/-/g, '')),
		rulesVersion: String(d.rules_version),
	}
}

export const encodeAttestation = (a: Attestation): `0x${string}` =>
	encodeAbiParameters(parseAbiParameters('bytes32 subjectId, bytes32 attestationHash, uint8 decision, uint32 day'), [
		a.subjectId as `0x${string}`,
		a.attestationHash as `0x${string}`,
		a.decisionCode,
		a.day,
	])

export const onKybRequest = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
	if (!payload.input || payload.input.length === 0) throw new Error('HTTP trigger payload is required')
	const req = requestSchema.parse(JSON.parse(Buffer.from(payload.input).toString('utf-8')))
	runtime.log(`KYB attestation requested for VAT ${req.vat}`)

	const http = new cre.capabilities.HTTPClient()
	const att = http
		.sendRequest(
			runtime,
			fetchAttestation,
			ConsensusAggregationByFields<Attestation>({
				subjectId: identical,
				attestationHash: identical,
				decisionCode: identical,
				day: identical,
				rulesVersion: identical,
			}),
		)(runtime.config, req)
		.result()
	runtime.log(`Consensus: decision=${DECISIONS[att.decisionCode]} attestation=${att.attestationHash} day=${att.day}`)

	const evm = runtime.config.evms[0]
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: evm.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`unknown chain ${evm.chainSelectorName}`)
	const evmClient = new EVMClient(network.chainSelector.selector)

	const report = runtime
		.report({ encodedPayload: hexToBase64(encodeAttestation(att)), encoderName: 'evm', signingAlgo: 'ecdsa', hashingAlgo: 'keccak256' })
		.result()
	const resp = evmClient
		.writeReport(runtime, { receiver: evm.registryAddress, report, gasConfig: { gasLimit: evm.gasLimit } })
		.result()
	if (resp.txStatus !== TxStatus.SUCCESS) throw new Error(`writeReport failed: ${resp.errorMessage || resp.txStatus}`)
	const txHash = bytesToHex(resp.txHash || new Uint8Array(32))
	runtime.log(`Attestation written to ${evm.registryAddress} tx ${txHash}`)
	return JSON.stringify({ vat: req.vat, decision: DECISIONS[att.decisionCode], attestationHash: att.attestationHash, subjectId: att.subjectId, day: att.day, txHash })
}

export const initWorkflow = (config: Config) => {
	const httpTrigger = new cre.capabilities.HTTPCapability()
	return [cre.handler(httpTrigger.trigger({}), onKybRequest)]
}
