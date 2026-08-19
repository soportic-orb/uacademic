/*
  The one screen that cannot go through i18next (R1): it is what shows when the
  application failed to start, and i18next is one of the things that can fail.
  The three languages are written out instead, and the styles are inline for the
  same reason — the stylesheet may be what did not load.
*/
/* eslint-disable i18next/no-literal-string */
import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * The outermost net.
 *
 * React unmounts the whole tree when a render throws, so without this the
 * result is a white page: no message, no way back, and nothing for the person
 * on the other end to report. Everything below the router already has one —
 * this catches the providers themselves.
 *
 * It cannot use i18next: the failure may be i18next.
 */
interface State {
  error: Error | null
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UAcademic failed to render', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <main
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          fontFamily: 'Inter, system-ui, sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
        }}
      >
        <div style={{ maxWidth: '32rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            UAcademic
          </h1>
          <p style={{ marginBottom: '1rem' }}>
            Alguna cosa ha fallat en carregar la pantalla. · Algo ha fallado al cargar la pantalla.
            · Something went wrong while loading this screen.
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: '0.75rem',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '0.5rem',
              padding: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            {error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.assign('/')}
            style={{
              background: '#0072CE',
              color: '#ffffff',
              border: 0,
              borderRadius: '0.5rem',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Torna a començar · Volver a empezar · Start over
          </button>
        </div>
      </main>
    )
  }
}
