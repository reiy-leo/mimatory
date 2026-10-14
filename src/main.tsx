import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './app/i18n'
import { applyNativeVibrancyFlag } from './app/vibrancy'
import './styles.css'

applyNativeVibrancyFlag()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
