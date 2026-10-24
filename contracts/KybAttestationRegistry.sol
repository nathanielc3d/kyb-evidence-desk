// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title KybAttestationRegistry
/// @notice Stores KYB attestations delivered by a Chainlink CRE workflow through the Keystone forwarder.
///         Only hashes go on-chain: subjectId = sha256("vat:" + VAT number), attestationHash = sha256 of the
///         canonical attestation core. No IBAN, name or other personal data is ever written here (GDPR art. 5(1)(c)).
interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

contract KybAttestationRegistry is IReceiver {
    struct Attestation {
        bytes32 attestationHash;
        uint8 decision; // 0 pass, 1 review, 2 fail
        uint32 day; // yyyymmdd (UTC)
        uint64 recordedAt;
    }

    address public immutable forwarder;
    mapping(bytes32 => Attestation[]) private history;

    event KybAttested(bytes32 indexed subjectId, bytes32 indexed attestationHash, uint8 decision, uint32 day);

    error NotForwarder(address sender);
    error BadDecision(uint8 decision);

    constructor(address _forwarder) {
        forwarder = _forwarder;
    }

    function onReport(bytes calldata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert NotForwarder(msg.sender);
        (bytes32 subjectId, bytes32 attestationHash, uint8 decision, uint32 day) =
            abi.decode(report, (bytes32, bytes32, uint8, uint32));
        if (decision > 2) revert BadDecision(decision);
        history[subjectId].push(Attestation(attestationHash, decision, day, uint64(block.timestamp)));
        emit KybAttested(subjectId, attestationHash, decision, day);
    }

    function latest(bytes32 subjectId) external view returns (Attestation memory) {
        Attestation[] storage h = history[subjectId];
        require(h.length > 0, "no attestation");
        return h[h.length - 1];
    }

    function count(bytes32 subjectId) external view returns (uint256) {
        return history[subjectId].length;
    }

    /// @notice True if this exact attestation hash was ever recorded for the subject (audit lookup).
    function wasAttested(bytes32 subjectId, bytes32 attestationHash) external view returns (bool) {
        Attestation[] storage h = history[subjectId];
        for (uint256 i = 0; i < h.length; i++) if (h[i].attestationHash == attestationHash) return true;
        return false;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == 0x01ffc9a7;
    }
}
