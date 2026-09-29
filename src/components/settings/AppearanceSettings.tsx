import { Check, Moon, Palette, Sun } from 'lucide-react'
import { SettingsSection } from './SettingsSection'

export function AppearanceSettings() { return <SettingsSection icon={Palette} title="Appearance" description="Personalise how Personal Finance looks."><div className="theme-options"><button className="theme-card selected" aria-pressed="true"><span><Moon/></span><div><strong>Dark</strong><small>Current theme</small></div><Check/></button><button className="theme-card" disabled><span><Sun/></span><div><strong>Light</strong><small>Coming later</small></div></button></div></SettingsSection> }
