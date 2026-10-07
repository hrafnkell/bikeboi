// Reads the per-second records back out of a FIT file bikeboi wrote, for graphs.

export interface FitTrack {
  /** Seconds from the first record, one entry per record. */
  seconds: number[];
  power: number[];
  cadence: number[];
  /** null where the file holds no reading. */
  heartRate: Array<number | null>;
  altitude: number[];
  distance: number[];
  speed: number[];
}

interface DecodedMessage {
  type: string;
  name: string;
  fields: Record<string, number>;
}

/** The borrowed decoder logs as it goes; keep that out of the console. */
async function decodeQuietly(fit: Uint8Array): Promise<DecodedMessage[]> {
  // @ts-ignore vendored JS without types
  const { FITjs } = await import('../vendor/auuki/fit/fitjs.js');
  const log = console.log;
  console.log = () => {};
  try {
    const view = new DataView(fit.buffer, fit.byteOffset, fit.byteLength);
    return (FITjs.decode(view) as DecodedMessage[]).filter((m) => m.type === 'data');
  } finally {
    console.log = log;
  }
}

export async function readFitTrack(fit: Uint8Array): Promise<FitTrack> {
  const records = (await decodeQuietly(fit)).filter((m) => m.name === 'record');
  const t0 = records[0]?.fields.timestamp ?? 0;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    seconds: records.map((r) => Math.round((num(r.fields.timestamp) - t0) / 1000)),
    power: records.map((r) => num(r.fields.power)),
    cadence: records.map((r) => num(r.fields.cadence)),
    heartRate: records.map((r) => {
      const hr = r.fields.heart_rate;
      return typeof hr === 'number' && hr > 0 && hr < 255 ? hr : null;
    }),
    altitude: records.map((r) => num(r.fields.altitude)),
    distance: records.map((r) => num(r.fields.distance)),
    speed: records.map((r) => num(r.fields.speed)),
  };
}
