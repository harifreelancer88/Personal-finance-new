import { useState, type FormEvent } from 'react'
import type { Profile } from '../../data/settingsData'
import { Modal } from '../transactions/Modal'

export function EditProfileForm({ profile, onSave, onClose }: { profile: Profile; onSave: (profile: Profile) => void; onClose: () => void }) {
 const [draft,setDraft]=useState(profile); const update=(key:keyof Profile,value:string)=>setDraft(old=>({...old,[key]:value}));
 const submit=(e:FormEvent)=>{e.preventDefault();onSave(draft)}
 return <Modal title="Edit personal information" description="Update the details shown in your family finance space." onClose={onClose}><form className="transaction-form" onSubmit={submit}><div className="form-grid"><label><span>First Name</span><input required autoFocus value={draft.firstName} onChange={e=>update('firstName',e.target.value)}/></label><label><span>Last Name</span><input required value={draft.lastName} onChange={e=>update('lastName',e.target.value)}/></label><label><span>Date of Birth</span><input required type="date" value={draft.dateOfBirth} onChange={e=>update('dateOfBirth',e.target.value)}/></label><label><span>Phone</span><input required type="tel" value={draft.phone} onChange={e=>update('phone',e.target.value)}/></label><label className="full"><span>Email</span><input required type="email" value={draft.email} onChange={e=>update('email',e.target.value)}/></label></div><footer className="dialog-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button">Save changes</button></footer></form></Modal>
}
