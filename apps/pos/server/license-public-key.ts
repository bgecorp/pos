/**
 * Public half of the API's license signing key (Ed25519, SPKI DER, base64).
 * It can only VERIFY tokens, so it's safe to ship with the POS. Regenerate both
 * halves with `npm run license:keygen -w @pos/api`. Override with POS_LICENSE_PUBLIC_KEY.
 */
const BUILT_IN = 'MCowBQYDK2VwAyEA9RPGjyGTgnN1EfPFPUNOwehpoMzJpXvmpYM7Sy0UHHY=';

export const licensePublicKey = (): string => process.env.POS_LICENSE_PUBLIC_KEY || BUILT_IN;
