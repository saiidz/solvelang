const jsonLdEscapes = Object.freeze({
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
});

const unsafeJsonLdCharacters = /[<>&\u2028\u2029]/g;

/**
 * Serialize structured data for an inline application/ld+json script without
 * allowing JSON string content to terminate or alter the surrounding script.
 *
 * @param {unknown} data
 * @returns {string}
 */
export function serializeJsonLd(data) {
  const serialized = JSON.stringify(data);
  if (serialized === undefined) return "null";
  return serialized.replace(
    unsafeJsonLdCharacters,
    (character) => jsonLdEscapes[character] ?? character,
  );
}
