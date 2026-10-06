type CsvPerson = { employeeCode: string; name: string; username?: string | null };

export function scheduleImportIdentifier(person: CsvPerson): string {
  return person.username ? `@${person.username}` : person.employeeCode;
}

function csvCell(value: string): string {
  // Quoting CSV alone does not prevent spreadsheet formula evaluation.
  const literal = /^[=+@\-\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${literal.replaceAll('"', '""')}"`;
}

/** Blank assignment fields must be completed by the operator before review. */
export function scheduleCsvTemplate(people: CsvPerson[]): string {
  return '\uFEFFID_COLABORADOR;NOMBRE;FECHA;CODIGO;INICIO;TERMINO\r\n' + people.map(person => [scheduleImportIdentifier(person), person.name, '', '', '', ''].map(csvCell).join(';')).join('\r\n') + (people.length ? '\r\n' : '');
}

/** Accept the literal marker retained by spreadsheet editors without changing names. */
export function scheduleCsvText(value: string): string {
  return /^'[=+@\-\t\r\n]/.test(value) ? value.slice(1) : value;
}
