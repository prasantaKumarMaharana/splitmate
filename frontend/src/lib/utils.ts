export function formatAmount(paise: number): string {
  const rupees = paise / 100
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(rupees)
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100)
}

export function paiseToRupees(paise: number): number {
  return paise / 100
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric'
  })
}

export function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

export function eventTypeLabel(type: string): string {
  const map: Record<string, string> = {
    expense_added: 'added an expense',
    expense_edited: 'edited an expense',
    expense_deleted: 'deleted an expense',
    member_added: 'was added to the group',
    member_removed: 'was removed from the group',
    settlement_recorded: 'recorded a payment',
  }
  return map[type] || type
}
