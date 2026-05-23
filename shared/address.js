"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVM_CHAINS = exports.ADDRESS_RE = exports.TRON_ADDRESS_RE = exports.EVM_ADDRESS_RE = void 0;
exports.isEvmChain = isEvmChain;
exports.isEvmAddress = isEvmAddress;
exports.isTronAddress = isTronAddress;
exports.isValidAddress = isValidAddress;
exports.validateAddressForChain = validateAddressForChain;
exports.normalizeAddressForChain = normalizeAddressForChain;
exports.EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
exports.TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
exports.ADDRESS_RE = /^(?:0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})$/;
exports.EVM_CHAINS = ['ethereum', 'polygon', 'arbitrum', 'base'];
function isEvmChain(chain) {
    return exports.EVM_CHAINS.includes(chain);
}
function isEvmAddress(addr) {
    return exports.EVM_ADDRESS_RE.test(addr);
}
function isTronAddress(addr) {
    return exports.TRON_ADDRESS_RE.test(addr);
}
function isValidAddress(addr) {
    return exports.EVM_ADDRESS_RE.test(addr) || exports.TRON_ADDRESS_RE.test(addr);
}
function validateAddressForChain(addr, chain) {
    if (isEvmChain(chain)) {
        if (!isEvmAddress(addr)) {
            return `${chain} requires an EVM address (0x + 40 hex)`;
        }
        return null;
    }
    if (chain === 'tron') {
        if (!isTronAddress(addr)) {
            return 'tron requires a base58 address starting with T';
        }
        return null;
    }
    return `unsupported chain: ${chain}`;
}
function normalizeAddressForChain(addr, chain) {
    const trimmed = addr.trim();
    return isEvmChain(chain) ? trimmed.toLowerCase() : trimmed;
}
//# sourceMappingURL=address.js.map