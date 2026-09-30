import { PreviewNotice } from '../components/ui/PreviewNotice'
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { AboutSettings } from '../components/settings/AboutSettings'
import { AppearanceSettings } from '../components/settings/AppearanceSettings'
import { CategoryForm } from '../components/settings/CategoryForm'
import { CategorySettings } from '../components/settings/CategorySettings'
import { DataPrivacySettings } from '../components/settings/DataPrivacySettings'
import { EditProfileForm } from '../components/settings/EditProfileForm'
import { FamilyMemberForm } from '../components/settings/FamilyMemberForm'
import { FamilySettings } from '../components/settings/FamilySettings'
import { PreferenceSettings } from '../components/settings/PreferenceSettings'
import { ProfileSettings } from '../components/settings/ProfileSettings'
import { PageHeader } from '../components/layout/PageHeader'
import { ConfirmDialog } from '../components/transactions/ConfirmDialog'
import { initialCategories, initialFamilyMembers, initialPreferences, initialProfile, type FamilyMember } from '../data/settingsData'

export function SettingsPage() {
 const {openMenu}=useOutletContext<{openMenu:()=>void}>(); const [profile,setProfile]=useState(initialProfile); const [editProfile,setEditProfile]=useState(false); const [members,setMembers]=useState(initialFamilyMembers); const [memberForm,setMemberForm]=useState<FamilyMember|null|undefined>(); const [removeMember,setRemoveMember]=useState<FamilyMember>(); const [preferences,setPreferences]=useState(initialPreferences); const [categories,setCategories]=useState(initialCategories); const [categoryForm,setCategoryForm]=useState<string|null|undefined>(); const [removeCategory,setRemoveCategory]=useState<string>(); const [notice,setNotice]=useState('')
 const saveMember=(member:FamilyMember)=>{setMembers(old=>old.some(x=>x.id===member.id)?old.map(x=>x.id===member.id?member:x):[...old,member]);setMemberForm(undefined)}
 const saveCategory=(name:string)=>{setCategories(old=>categoryForm?old.map(x=>x===categoryForm?name:x):[...old,name]);setCategoryForm(undefined)}
 return <><PageHeader title="Settings" eyebrow="Personalise your workspace" onMenu={openMenu}/><main className="page-body settings-page"><div className="settings-intro"><h2>Settings</h2><p>Manage your profile, family and finance preferences.</p></div>{notice&&<div className="settings-notice" role="status">{notice} is a preview action. Your data has not changed.<button onClick={()=>setNotice('')} aria-label="Dismiss message">×</button></div>}<PreviewNotice>Profile, family, categories and preferences are previews. Changes are temporary, reset when you leave this page or reload, and do not update your live transactions or accounts.</PreviewNotice><div className="settings-grid"><ProfileSettings profile={profile} onEdit={()=>setEditProfile(true)}/><FamilySettings members={members} onAdd={()=>setMemberForm(null)} onEdit={setMemberForm} onRemove={setRemoveMember} onToggle={id=>setMembers(old=>old.map(x=>x.id===id?{...x,included:!x.included}:x))}/><PreferenceSettings value={preferences} onChange={setPreferences}/><CategorySettings categories={categories} onAdd={()=>setCategoryForm(null)} onEdit={setCategoryForm} onDelete={setRemoveCategory}/><AppearanceSettings/><DataPrivacySettings onAction={setNotice}/><AboutSettings/></div></main>
 {editProfile&&<EditProfileForm profile={profile} onClose={()=>setEditProfile(false)} onSave={value=>{setProfile(value);setEditProfile(false)}}/>}{memberForm!==undefined&&<FamilyMemberForm initial={memberForm??undefined} onClose={()=>setMemberForm(undefined)} onSave={saveMember}/>} {categoryForm!==undefined&&<CategoryForm initial={categoryForm??undefined} categories={categories} onClose={()=>setCategoryForm(undefined)} onSave={saveCategory}/>} {removeMember&&<ConfirmDialog subject="family member" name={removeMember.name} onCancel={()=>setRemoveMember(undefined)} onConfirm={()=>{setMembers(old=>old.filter(x=>x.id!==removeMember.id));setRemoveMember(undefined)}}/>}{removeCategory&&<ConfirmDialog subject="category" name={removeCategory} onCancel={()=>setRemoveCategory(undefined)} onConfirm={()=>{setCategories(old=>old.filter(x=>x!==removeCategory));setRemoveCategory(undefined)}}/>}</>
}
