import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readStructuredReport, type TextFragment } from '@/domain/pms/layout';
import { normalizeReport } from '@/domain/pms/normalize';
import { parseDelimited, readReportFile } from '@/server/pms/read-report-file';

describe('importación PMS independiente de plantilla', () => {
  it('acepta ID alfanumérico y cabecera partida en dos líneas', () => {
    const fragments: TextFragment[] = [
      { page: 1, x: 40, y: 560, text: 'Exportación operativa' },
      { page: 1, x: 40, y: 520, text: 'Booking' },
      { page: 1, x: 160, y: 520, text: 'Reservation' },
      { page: 1, x: 280, y: 520, text: 'Guest' },
      { page: 1, x: 400, y: 520, text: 'Arrival' },
      { page: 1, x: 520, y: 520, text: 'Departure' },
      { page: 1, x: 640, y: 520, text: 'Room' },
      { page: 1, x: 40, y: 500, text: 'Number' },
      { page: 1, x: 160, y: 500, text: 'Status' },
      { page: 1, x: 280, y: 500, text: 'Name' },
      { page: 1, x: 400, y: 500, text: 'Date' },
      { page: 1, x: 520, y: 500, text: 'Date' },
      { page: 1, x: 640, y: 500, text: 'Number' },
      { page: 1, x: 40, y: 480, text: 'BK-20481' },
      { page: 1, x: 160, y: 480, text: 'Checked in' },
      { page: 1, x: 280, y: 480, text: 'Ana Pérez' },
      { page: 1, x: 400, y: 480, text: '2026-09-20' },
      { page: 1, x: 520, y: 480, text: '2026-09-23' },
      { page: 1, x: 640, y: 480, text: '420' },
    ];

    const structured = readStructuredReport(fragments);
    const normalized = normalizeReport(structured);
    expect(structured.kind).toBe('ACTIVIDAD');
    expect(structured.kindSource).toBe('columnas');
    expect(normalized?.stays[0]).toMatchObject({
      reservationId: 'BK-20481',
      roomNumber: '420',
      guestNames: ['Ana Pérez'],
      operationalStatus: 'IN_HOUSE',
    });
    expect(normalized?.stays[0]?.arrivalDate?.toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });

  it('lee CSV con columnas reordenadas, separador punto y coma y texto entre comillas', () => {
    const rows = parseDelimited(
      'Room;Customer Name;Status;Confirmation Number;Departure Date;Arrival Date\n' +
      '421;"Rojas, Camila";Due out;HTL/9082;21/09/2026;18/09/2026\n',
    );
    expect(rows[1]).toEqual(['421', 'Rojas, Camila', 'Due out', 'HTL/9082', '21/09/2026', '18/09/2026']);
  });

  it('convierte una hoja Excel en el mismo modelo semántico', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Operación');
    sheet.addRow(['Room No', 'Guest Name', 'Stay Status', 'Booking No', 'Arrival Date', 'Departure Date']);
    sheet.addRow(['422', 'Diego Soto', 'Due in', 'WEB-7712', new Date('2026-09-20T00:00:00Z'), new Date('2026-09-22T00:00:00Z')]);
    const buffer = await workbook.xlsx.writeBuffer();

    const [extracted] = await readReportFile('reservas.xlsx', new Uint8Array(buffer));
    expect(extracted).toBeTruthy();
    const normalized = normalizeReport(readStructuredReport(extracted?.fragments ?? []));
    expect(normalized?.stays[0]).toMatchObject({
      reservationId: 'WEB-7712',
      roomNumber: '422',
      guestNames: ['Diego Soto'],
      operationalStatus: 'CHECK_IN',
    });
  });
});
