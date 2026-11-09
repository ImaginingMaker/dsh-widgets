/**
 * Read one optional service off a cordis context, or undefined.
 *
 * cordis throws `cannot get property "X" without inject` for a service a plugin did not declare, and a profile may not
 * have the service at all. Neither is a reason for a widget to fail to load, so every optional read goes through here.
 */
export function read<T>(reader: () => T | undefined): T | undefined {
  try {
    return reader();
  } catch {
    return undefined;
  }
}
