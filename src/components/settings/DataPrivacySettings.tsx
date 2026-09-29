import { Database, Download, RotateCcw, ShieldCheck, Upload } from 'lucide-react'
import { SettingsSection } from './SettingsSection'

const actions=[{name:'Export Data',detail:'Download a copy of your demo data',icon:Download},{name:'Import Data',detail:'Bring data into this workspace',icon:Upload},{name:'Backup',detail:'Create a local demo backup',icon:Database},{name:'Clear Local Demo Data',detail:'Reset frontend demo changes',icon:RotateCcw,danger:true}]
export function DataPrivacySettings({ onAction }: { onAction:(name:string)=>void }) { return <SettingsSection icon={ShieldCheck} title="Data & privacy" description="Your controls for local demo data. No action uploads data."><div className="privacy-actions">{actions.map(({name,detail,icon:Icon,danger})=><button key={name} className={danger?'danger':''} onClick={()=>onAction(name)}><span><Icon/></span><div><strong>{name}</strong><small>{detail}</small></div></button>)}</div></SettingsSection> }
