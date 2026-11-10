import { useState, type FormEvent } from 'react';
import type { StaffMember, StaffRole } from '../../../shared/types';
import { ProOnly } from '../components/ProLock';
import { Alert, Button, Card, Empty, Field, Modal, PageTitle, SelectField, useToast } from '../components/ui';
import { call, useLoad } from '../lib/pos';

const ROLE_LABEL: Record<StaffRole, string> = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier' };

export function StaffPage() {
  return (
    <ProOnly
      title="Staff management"
      description="Add your cashiers with their own PIN. Each sale records who made it, and Reports show sales per cashier."
    >
      <StaffList />
    </ProOnly>
  );
}

function StaffList() {
  const staff = useLoad(() => call('staff:list', { includeInactive: true }));
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null);
  return (
    <>
      <PageTitle title="Staff" actions={<Button onClick={() => setEditing('new')}>+ Add staff</Button>} />
      <p className="mb-4 text-sm text-slate-500">
        On the Sell screen, cashiers tap <b>Switch cashier</b>, pick their name and enter their PIN.
      </p>
      {staff.error && <Alert>{staff.error}</Alert>}
      <Card>
        <ul className="divide-y divide-slate-100">
          {staff.data?.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className={s.isActive ? '' : 'text-slate-400 line-through'}>
                <span className="font-medium">{s.name}</span>
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{ROLE_LABEL[s.role]}</span>
              </span>
              <Button variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
            </li>
          ))}
        </ul>
        {staff.data?.length === 0 && <Empty>No staff yet. Add the people who use this POS.</Empty>}
      </Card>
      {editing && (
        <StaffModal
          member={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            staff.reload();
          }}
        />
      )}
    </>
  );
}

function StaffModal({ member, onClose, onSaved }: { member: StaffMember | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(member?.name ?? '');
  const [role, setRole] = useState<StaffRole>(member?.role ?? 'cashier');
  const [pin, setPin] = useState('');
  const [active, setActive] = useState(member?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await call('staff:save', { id: member?.id, name, role, pin: pin || undefined, isActive: active });
      toast(member ? 'Staff updated' : 'Staff added');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal
      title={member ? `Edit ${member.name}` : 'Add staff'}
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="staff-form">Save</Button></>}
    >
      <form id="staff-form" onSubmit={save} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
          <option value="cashier">Cashier</option>
          <option value="manager">Manager</option>
          <option value="owner">Owner</option>
        </SelectField>
        <Field
          label={member ? 'New PIN (leave empty to keep)' : 'PIN'}
          inputMode="numeric"
          type="password"
          autoComplete="new-password"
          required={!member}
          pattern="\d{4,6}"
          title="4 to 6 digits"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          hint="4 to 6 digits"
        />
        {member && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (can sell)
          </label>
        )}
      </form>
    </Modal>
  );
}
