/**
 * Preact writes autocorrect as a property, where the text "off" is truthy and so means on. The JSX
 * types only allow text, which is how that mistake stayed hidden.
 */
export const AUTOCORRECT_OFF = false as unknown as string;
