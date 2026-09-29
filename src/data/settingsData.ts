export type Profile = { firstName: string; lastName: string; dateOfBirth: string; email: string; phone: string }
export type FamilyMember = { id: string; name: string; relationship: string; label: string; included: boolean }
export type Preferences = { currency: string; dateFormat: string; financialYearStart: string; landingPage: string; density: 'Comfortable' | 'Compact' }

export const initialProfile: Profile = { firstName: 'Arjun', lastName: 'Kumar', dateOfBirth: '1991-08-14', email: 'arjun.kumar@example.com', phone: '+91 98765 43210' }
export const initialFamilyMembers: FamilyMember[] = [
  { id: 'family-1', name: 'Arjun Kumar', relationship: 'Self', label: 'AK', included: true },
  { id: 'family-2', name: 'Sneha Kumar', relationship: 'Spouse', label: 'SK', included: true },
  { id: 'family-3', name: 'Aarav Kumar', relationship: 'Child', label: 'ARK', included: false },
]
export const initialPreferences: Preferences = { currency: 'INR (₹)', dateFormat: 'DD/MM/YYYY', financialYearStart: 'April', landingPage: 'Dashboard', density: 'Comfortable' }
export const initialCategories = ['Groceries', 'Food & Dining', 'Shopping', 'Transport', 'Utilities', 'School / Education', 'Entertainment', 'Healthcare', 'Housing', 'Other']
