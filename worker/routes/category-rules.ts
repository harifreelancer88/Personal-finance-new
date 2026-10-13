import { success, methodNotAllowed } from '../lib/http'
import { ApiError,parseJsonObject } from '../lib/transaction-validation'
import { merchantKeyword } from '../lib/category-rules'
import { listCategoryRules,learnHistory,learnManualCategory } from '../repositories/category-rules'
import type { Env } from '../types'
export async function categoryRulesRoute(request: Request, env: Env, id?: string) {
 const db=env.DB,workspace=env.DEFAULT_WORKSPACE_ID
 if(id==='learn'){if(request.method!=='POST')return methodNotAllowed();return success(await learnHistory(db,workspace))}
 if(!id&&request.method==='GET')return success(await listCategoryRules(db,workspace))
 if((!id&&request.method==='POST')||(id&&request.method==='PATCH')){
  const current=id?(await listCategoryRules(db,workspace)).find(r=>r.id===id):undefined
  if(id&&!current)throw new ApiError(404,'RULE_NOT_FOUND','Rule not found.')
  let value:Record<string,unknown>;try{value=parseJsonObject(await request.json())}catch{throw new ApiError(400,'INVALID_JSON','Enter valid rule details.')}
  const raw=value.keyword??current?.keyword, type=value.transactionType??current?.transaction_type
  const keyword=typeof raw==='string'?merchantKeyword(raw):null
  if(!keyword||!['expense','income','refund'].includes(String(type)))throw new ApiError(400,'INVALID_RULE','Use a specific merchant keyword and valid transaction type.')
  const category='categoryId' in value?value.categoryId:current?.category_id
  const active='isActive' in value?value.isActive:current?current.is_active===1:true
  if(typeof active!=='boolean'||(active&&!category))throw new ApiError(400,'INVALID_RULE','Active rules need a category.')
  if(category!==null&&typeof category!=='string')throw new ApiError(400,'INVALID_RULE','Choose a category.')
  if(category){const c=await db.prepare('SELECT kind,is_active FROM categories WHERE id=? AND workspace_id=?').bind(category,workspace).first<{kind:string;is_active:number}>();if(!c||!c.is_active||!(c.kind==='both'||c.kind===(type==='income'?'income':'expense')))throw new ApiError(400,'INVALID_CATEGORY','Choose an active category of the right kind.')}
  const duplicate=await db.prepare('SELECT id FROM category_rules WHERE workspace_id=? AND keyword=? AND transaction_type=? AND id<>?').bind(workspace,keyword,type,id??'').first()
  if(duplicate)throw new ApiError(409,'RULE_EXISTS','This keyword already has a rule for this transaction type.')
  if(id)await db.prepare("UPDATE category_rules SET keyword=?,transaction_type=?,category_id=?,is_active=?,source='manual',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(keyword,type,category,active?1:0,id,workspace).run()
  else{await learnManualCategory(db,workspace,String(type),keyword,category as string|null);if(!active)await db.prepare('UPDATE category_rules SET is_active=0 WHERE workspace_id=? AND keyword=? AND transaction_type=?').bind(workspace,keyword,type).run()}
  return success(await listCategoryRules(db,workspace))
 }
 return methodNotAllowed()
}
