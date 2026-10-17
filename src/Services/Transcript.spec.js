import { createVerificationUrl, extractRegistryFromQr, normalizeRegistry } from './Transcript';

const registry = 'TB10/SR/MN/5777/2015';

describe('transcript registry lookup', () => {
    it('normalizes register numbers for worksheet matching', () => {
        expect(normalizeRegistry(registry)).toBe('TB10SRMN57772015');
    });

    it('creates the canonical verification URL for generated QR codes', () => {
        expect(createVerificationUrl('https://records.example/', registry))
            .toBe(`https://records.example/verify/${registry}`);
    });

    it('extracts a register number from a QR URL or plain text', () => {
        expect(extractRegistryFromQr(`https://records.example/verify?register=${encodeURIComponent(registry)}`)).toBe(registry);
        expect(extractRegistryFromQr(`https://records.example/${registry}`)).toBe(registry);
        expect(extractRegistryFromQr(`https://records.example/verify/${registry}`)).toBe(registry);
        expect(extractRegistryFromQr(`Register: ${registry}`)).toBe(registry);
    });

});