import { apiRequest } from './client'
export interface CategoryDto { id: string; name: string; kind: 'expense' | 'income' | 'both'; isActive: boolean }
export const getCategories = () => apiRequest<CategoryDto[]>('/api/categories')
