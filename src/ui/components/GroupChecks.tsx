import type { Group } from '../../data/types';

/** A checkbox per custom list, shared by the word form and the word's list dialog. */
export function GroupChecks({ groups, selected, onChange }: { groups: readonly Group[]; selected: ReadonlySet<string>; onChange: (next: Set<string>) => void }) {
  return (
    <ul class="check-list">
      {groups.map((group) => (
        <li key={group.id}>
          <label class="check-row">
            <input
              type="checkbox"
              checked={selected.has(group.id)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.currentTarget.checked) next.add(group.id);
                else next.delete(group.id);
                onChange(next);
              }}
            />
            <span>{group.name}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
