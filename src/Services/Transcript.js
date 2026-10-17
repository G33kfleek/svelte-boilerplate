const REGISTRY_PATTERN = /[A-Z0-9]+(?:\/[A-Z0-9]+){2,}\/[0-9]+\/[0-9]+/i;

export function normalizeRegistry(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function createVerificationUrl(origin, registry) {
    const path = String(registry || '').split('/').map(encodeURIComponent).join('/');
    return `${String(origin || '').replace(/\/+$/, '')}/verify/${path}`;
}

export function extractRegistryFromQr(value) {
    let content = String(value || '').trim();
    try {
        content = decodeURIComponent(content);
    } catch (error) {}

    try {
        const url = new URL(content, 'https://records.invalid');
        const queryRegistry = url.searchParams.get('register') ||
            url.searchParams.get('registry') ||
            url.searchParams.get('registrationNumber') ||
            url.searchParams.get('studentId');
        if (queryRegistry) {
            return queryRegistry.trim();
        }
        const registryPath = url.pathname.replace(/^\/verify\//i, '/');
        const pathMatch = registryPath.match(REGISTRY_PATTERN);
        if (pathMatch) {
            return pathMatch[0];
        }
    } catch (error) {}

    const match = content.match(REGISTRY_PATTERN);
    return match ? match[0] : '';
}