// Words for Settings → Consoles that the server's tests check too (no imports, so both builds can use it).

/** A need's sentence without its closing "Put it in <folder>." (the folder is shown on its own; it can have spaces). */
export const withoutFolder = (detail: string) => detail.replace(/ ?Put it in .*$/, '')
