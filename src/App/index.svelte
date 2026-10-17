<script>
    import { onDestroy, onMount } from 'svelte';
    import Layout from '@Components/Layout';
    import QRCode from 'qrcode';
    import { createVerificationUrl, extractRegistryFromQr } from '@Services/Transcript';

    let registryValue = '';
    let profile = null;
    let verificationUrl = '';
    let verificationPath = '';
    let verificationQr = '';
    let loadError = '';
    let lookupMessage = '';
    let cameraMessage = '';
    let loginMessage = '';
    let downloadMessage = '';
    let username = '';
    let password = '';
    let signedIn = false;
    let pendingFormat = 'pdf';
    let scannerSupported = false;
    let scanning = false;
    let lookingUp = false;
    let loginOpen = false;
    let loginPending = false;
    let videoElement;
    let cameraStream;
    let scanFrame;

    onMount(() => {
        scannerSupported = Boolean(
            navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.BarcodeDetector
        );

        const queryRegistry = new URLSearchParams(window.location.search).get('register');
        const initialRegistry = queryRegistry || extractRegistryFromQr(window.location.href);
        if (initialRegistry) {
            registryValue = initialRegistry;
            verifyRecord(initialRegistry);
        }
    });

    onDestroy(stopScanner);

    async function verifyRecord(value = registryValue) {
        const registry = extractRegistryFromQr(value) || value.trim();
        registryValue = registry;
        if (!registry) {
            profile = null;
            signedIn = false;
            verificationUrl = '';
            verificationPath = '';
            verificationQr = '';
            lookupMessage = 'Enter a register number to continue.';
            return;
        }

        lookingUp = true;
        profile = null;
        signedIn = false;
        verificationUrl = '';
        verificationPath = '';
        verificationQr = '';
        lookupMessage = '';
        loadError = '';
        try {
            const response = await fetch(`/api/verify?register=${encodeURIComponent(registry)}`);
            const result = await response.json();
            if (!response.ok) {
                lookupMessage = result.message || 'No matching student record was found.';
                return;
            }
            profile = result.profile;
            try {
                const sessionResponse = await fetch(`/api/session?register=${encodeURIComponent(result.profile.registry)}`);
                if (sessionResponse.ok) {
                    signedIn = (await sessionResponse.json()).signedIn;
                }
            } catch (error) {
                signedIn = false;
            }
            verificationUrl = createVerificationUrl(window.location.origin, result.profile.registry);
            verificationPath = new URL(verificationUrl).pathname;
            try {
                const qrSvg = await QRCode.toString(verificationUrl, {
                    type: 'svg',
                    width: 88,
                    margin: 1,
                    errorCorrectionLevel: 'M',
                    color: { dark: '#202b29', light: '#ffffff' }
                });
                verificationQr = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`;
            } catch (error) {
                cameraMessage = 'QR preview is unavailable in this browser.';
                verificationQr = '';
            }
            window.history.replaceState(null, '', verificationPath);
        } catch (error) {
            loadError = 'The transcript register could not be reached. Please try again later.';
        } finally {
            lookingUp = false;
        }
    }

    async function downloadTranscript(format) {
        downloadMessage = '';
        try {
            const query = new URLSearchParams({ register: registryValue, format });
            const response = await fetch(`/api/transcript?${query.toString()}`);
            if (response.status === 401 || response.status === 403) {
                signedIn = false;
                pendingFormat = format;
                username = registryValue;
                password = '';
                loginOpen = true;
                loginMessage = '';
                return;
            }
            if (!response.ok) {
                throw new Error('Transcript download failed');
            }
            const url = window.URL.createObjectURL(await response.blob());
            const link = document.createElement('a');
            link.href = url;
            link.download = format === 'xlsx' ? 'TRANSCRIPT.xlsx' : 'TRANSCRIPT.pdf';
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            downloadMessage = 'The transcript could not be downloaded. Please try again later.';
        }
    }

    async function signIn(event) {
        event.preventDefault();
        loginPending = true;
        loginMessage = '';
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const result = await response.json();
            if (!response.ok) {
                loginMessage = result.message || 'Sign-in failed.';
                return;
            }
            signedIn = true;
            loginOpen = false;
            password = '';
            await downloadTranscript(pendingFormat);
        } catch (error) {
            loginMessage = 'Sign-in is unavailable. Please try again later.';
        } finally {
            loginPending = false;
        }
    }

    async function signOut() {
        try {
            const response = await fetch('/api/logout', { method: 'POST' });
            if (!response.ok) {
                throw new Error('Sign-out failed');
            }
            signedIn = false;
            password = '';
            downloadMessage = '';
        } catch (error) {
            downloadMessage = 'Could not sign out. Please try again.';
        }
    }

    function stopScanner() {
        scanning = false;
        if (scanFrame) {
            window.cancelAnimationFrame(scanFrame);
            scanFrame = null;
        }
        if (cameraStream) {
            cameraStream.getTracks().forEach((track) => track.stop());
            cameraStream = null;
        }
        if (videoElement) {
            videoElement.srcObject = null;
        }
    }

    async function startScanner() {
        cameraMessage = '';
        if (!scannerSupported) {
            cameraMessage = 'Camera QR scanning is not available in this browser.';
            return;
        }

        try {
            const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            cameraStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { facingMode: { ideal: 'environment' } }
            });
            scanning = true;
            videoElement.srcObject = cameraStream;
            await videoElement.play();

            const scan = async () => {
                if (!scanning) {
                    return;
                }
                try {
                    const codes = await detector.detect(videoElement);
                    if (codes.length) {
                        const registry = extractRegistryFromQr(codes[0].rawValue);
                        stopScanner();
                        if (registry) {
                            verifyRecord(registry);
                        } else {
                            cameraMessage = 'The scanned QR code does not contain a register number.';
                        }
                        return;
                    }
                } catch (error) {
                    stopScanner();
                    cameraMessage = 'The QR code could not be read. Enter its register number instead.';
                    return;
                }
                scanFrame = window.requestAnimationFrame(scan);
            };

            scanFrame = window.requestAnimationFrame(scan);
        } catch (error) {
            stopScanner();
            cameraMessage = 'Camera access failed. Enter the register number instead.';
        }
    }
</script>

<style src="./style.scss">

</style>

<svelte:head>
    <title>Academic Transcripts | Transcript Verification</title>
    <meta name="description" content="Academic transcript record verification" />
</svelte:head>

<Layout>
    <main class="verification-page">
        <header class="masthead">
            <a class="wordmark" href="/" aria-label="Academic Transcripts home">
                <span class="wordmark__seal">AR</span>
                <span class="wordmark__text">Academic Transcripts</span>
            </a>
            <span class="masthead__label">REGISTRY SERVICES <span> / </span> DIGITAL VERIFICATION</span>
        </header>

        <section class="page-heading">
            <div>
                <p class="eyebrow">OFFICIAL RECORDS</p>
                <h1>Transcript verification</h1>
            </div>
            <p class="page-heading__note">Academic registry <span>·</span> Record lookup</p>
        </section>

        <section class="verification-grid" aria-label="Transcript lookup">
            <aside class="lookup-panel">
                <div class="lookup-panel__topline">
                    <span class="section-index">01</span>
                    <h2>Find a record</h2>
                </div>

                <form on:submit|preventDefault={() => verifyRecord()}>
                    <label for="registry-number">Register number</label>
                    <div class="registry-input">
                        <input
                            id="registry-number"
                            bind:value={registryValue}
                            placeholder="TB10/SR/MN/5777/2015"
                            autocomplete="off"
                            spellcheck="false"
                        />
                        <button class="search-button" type="submit" aria-label="Verify register number">
                            <span aria-hidden="true">↗</span>
                        </button>
                    </div>
                    <button
                        class="scan-button"
                        type="button"
                        on:click={startScanner}
                        disabled={!scannerSupported || scanning}
                    >
                        {scanning ? 'Scanning for QR code…' : 'Scan QR code'}
                    </button>
                </form>

                {#if scanning}
                    <video class="scanner-video" bind:this={videoElement} playsinline muted aria-label="QR code camera view"></video>
                    <button class="stop-button" type="button" on:click={stopScanner}>Stop camera</button>
                {/if}

                {#if cameraMessage}
                    <p class="form-message" role="status">{cameraMessage}</p>
                {/if}
                {#if lookupMessage}
                    <p class="form-message form-message--error" role="status">{lookupMessage}</p>
                {/if}
                {#if lookingUp}
                    <p class="form-message" role="status">Checking registry…</p>
                {/if}
                {#if loadError}
                    <p class="form-message form-message--error" role="alert">{loadError}</p>
                {/if}

                <div class="lookup-panel__footnote">
                    <span class="status-dot"></span>
                    <span>Server-side register check</span>
                </div>
            </aside>

            <section class="record-panel" aria-live="polite">
                {#if profile}
                    <div class="record-heading">
                        <div>
                            <p class="eyebrow">REGISTRY MATCH</p>
                            <h2>Student profile</h2>
                        </div>
                        <span class="verified-mark"><span aria-hidden="true">✓</span> Matched</span>
                    </div>

                    <div class="record-reference">
                        <div class="record-reference__details">
                            <span>REGISTER NUMBER</span>
                            <strong>{registryValue}</strong>
                            <a class="record-reference__route" href={verificationUrl}>{verificationPath}</a>
                        </div>
                        <a class="verification-qr" href={verificationUrl} aria-label="Open this student verification page">
                            <img src={verificationQr} alt="QR code for this verification page" />
                            <span>SCAN TO VERIFY</span>
                        </a>
                    </div>

                    <div class="profile-table-wrap">
                        <table class="profile-table">
                            <tbody>
                                {#each profile.fields as field}
                                    <tr>
                                        <th scope="row">{field[0]}</th>
                                        <td>{field[1]}</td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>

                    <div class="record-actions">
                        <div>
                            <p class="eyebrow">{signedIn ? 'SIGNED IN' : 'RESTRICTED DOWNLOAD'}</p>
                            <p class:document-name--signed-in={signedIn} class="document-name">
                                {signedIn ? `Signed in as ${profile.registry}` : 'Sign-in required'}
                            </p>
                        </div>
                        <div class="download-options">
                            <button class="download-button" type="button" on:click={() => downloadTranscript('pdf')}>
                                PDF <span aria-hidden="true">↓</span>
                            </button>
                            <button class="download-button download-button--outline" type="button" on:click={() => downloadTranscript('xlsx')}>
                                Excel <span aria-hidden="true">↓</span>
                            </button>
                            {#if signedIn}
                                <button class="signout-button" type="button" on:click={signOut}>Sign out</button>
                            {/if}
                        </div>
                    </div>
                    {#if downloadMessage}
                        <p class="form-message form-message--error" role="alert">{downloadMessage}</p>
                    {/if}
                    <p class="verification-note">A registry match confirms the reference number, not the physical integrity of a printed transcript.</p>
                {:else}
                    <div class="empty-record">
                        <div class="empty-record__number">02 <span> / </span> RECORD</div>
                        <div class="empty-record__rule"></div>
                        <h2>{loadError ? 'Register unavailable' : lookingUp ? 'Checking record' : 'Awaiting lookup'}</h2>
                        <p>{loadError ? 'The register could not be reached.' : 'A matched student profile will appear here.'}</p>
                    </div>
                {/if}
            </section>
        </section>

        {#if loginOpen}
            <div class="login-backdrop">
                <section class="login-dialog" role="dialog" aria-modal="true" aria-labelledby="login-title">
                    <button class="login-close" type="button" aria-label="Close sign-in" on:click={() => loginOpen = false}>×</button>
                    <p class="eyebrow">RESTRICTED DOCUMENT</p>
                    <h2 id="login-title">Sign in to download</h2>
                    <form on:submit={signIn}>
                        <label for="login-username">Username</label>
                        <input id="login-username" bind:value={username} autocomplete="username" readonly required />
                        <label for="login-password">Password</label>
                        <input id="login-password" type="password" bind:value={password} autocomplete="current-password" required />
                        {#if loginMessage}
                            <p class="form-message form-message--error" role="alert">{loginMessage}</p>
                        {/if}
                        <button class="download-button login-submit" type="submit" disabled={loginPending}>
                            {loginPending ? 'Signing in…' : 'Sign in and download'}
                        </button>
                    </form>
                </section>
            </div>
        {/if}

        <footer class="page-footer">
            <span>ACADEMIC TRANSCRIPTS</span>
            <span>TRANSCRIPT REGISTER <i>•</i> {new Date().getFullYear()}</span>
        </footer>
    </main>
</Layout>
