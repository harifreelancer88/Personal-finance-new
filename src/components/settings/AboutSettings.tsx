import { Heart, Info, LockKeyhole } from 'lucide-react'
import { Logo } from '../ui/Logo'
import { SettingsSection } from './SettingsSection'

export function AboutSettings() { return <SettingsSection icon={Info} title="About" description="A clear view of your money, made for everyday life."><div className="about-content"><Logo/><p>Personal Finance helps individuals and families understand accounts, spending, investments and reports in one calm workspace.</p><dl><div><dt>Version</dt><dd>0.1.0</dd></div><div><dt><LockKeyhole/>Privacy</dt><dd>Private by design</dd></div></dl><small>Made with <Heart aria-label="care"/> for better financial habits.</small></div></SettingsSection> }
