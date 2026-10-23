// First import: carries passless-* preferences over to mimatory-* before i18n reads the language.
import './app/storageMigration'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './app/i18n'
import { applyNativeVibrancyFlag } from './app/vibrancy'
import { applyPlatformAttributes } from './skin/runtime'
import './styles.css'
// Platform skins after the Apple base: tokens.css re-points the token values per skin, skins.css changes the
// shapes, mobile.css lays the one-pane phone layout. macOS needs none of them (the base *is* the Apple skin).
import './skin/tokens.css'
import './skin/skins.css'
import './skin/mobile.css'

applyPlatformAttributes()
applyNativeVibrancyFlag()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
