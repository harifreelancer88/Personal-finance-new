import { Pencil, UserRound } from 'lucide-react'
import type { Profile } from '../../data/settingsData'
import { SettingsSection } from './SettingsSection'

export function ProfileSettings({ profile, onEdit }: { profile: Profile; onEdit: () => void }) {
 const initials=`${profile.firstName[0]??''}${profile.lastName[0]??''}`
 return <SettingsSection icon={UserRound} title="Personal information" description="Your profile and contact details." action={<button className="outline-button settings-action" onClick={onEdit}><Pencil/>Edit</button>} className="profile-settings"><div className="profile-settings-grid"><div className="settings-avatar" aria-label="Profile picture placeholder">{initials}</div><dl><div><dt>First Name</dt><dd>{profile.firstName}</dd></div><div><dt>Last Name</dt><dd>{profile.lastName}</dd></div><div><dt>Date of Birth</dt><dd>{new Date(`${profile.dateOfBirth}T00:00:00`).toLocaleDateString('en-IN')}</dd></div><div><dt>Phone</dt><dd>{profile.phone}</dd></div><div className="wide"><dt>Email</dt><dd>{profile.email}</dd></div></dl></div></SettingsSection>
}
