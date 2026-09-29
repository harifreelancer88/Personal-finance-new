import { Pencil, Plus, Trash2, UsersRound } from 'lucide-react'
import type { FamilyMember } from '../../data/settingsData'
import { SettingsSection } from './SettingsSection'

export function FamilySettings({ members, onAdd, onEdit, onRemove, onToggle }: { members: FamilyMember[]; onAdd:()=>void; onEdit:(member:FamilyMember)=>void; onRemove:(member:FamilyMember)=>void; onToggle:(id:string)=>void }) {
 return <SettingsSection icon={UsersRound} title="Family" description="Choose who is included in your shared financial view." action={<button className="primary-button settings-action" onClick={onAdd}><Plus/>Add Family Member</button>}><div className="family-list">{members.map(member=><article className="family-member" key={member.id}><span className="member-avatar">{member.label}</span><div><strong>{member.name}</strong><small>{member.relationship}</small></div><label className="switch"><span className="sr-only">Include {member.name}</span><input type="checkbox" checked={member.included} onChange={()=>onToggle(member.id)}/><i/></label><button className="icon-button subtle" onClick={()=>onEdit(member)} aria-label={`Edit ${member.name}`}><Pencil/></button><button className="icon-button subtle danger-icon" onClick={()=>onRemove(member)} aria-label={`Remove ${member.name}`}><Trash2/></button></article>)}</div></SettingsSection>
}
