import App from './index.svelte'
import { render } from '@testing-library/svelte'

describe('App', () => {
    it('renders the transcript verification interface', () => {
        const { container, getByLabelText, getByText } = render(App)

        expect(container.querySelector('.layout')).not.toBeNull()
        expect(getByText('Transcript verification')).not.toBeNull()
        expect(getByLabelText('Register number')).not.toBeNull()
        expect(getByText('Scan QR code')).not.toBeNull()
        expect(getByText('Awaiting lookup')).not.toBeNull()
    })
})
