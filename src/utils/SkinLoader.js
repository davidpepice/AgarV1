/**
 * Dynamic skin loader using Vite's import.meta.glob.
 * Any .png/.jpg/.webp image placed in /public/skins/ will be
 * automatically included here. Restart dev server after adding new skins.
 */

// Vite resolves this glob relative to the project root.
// Files in public/skins/ are served at /skins/ in both dev and production.
const skinModules = import.meta.glob('/dist/skins/*.{png,jpg,jpeg,webp}', { eager: true });

/**
 * Returns an array of skin objects: { id, name, url }
 * id   = filename without extension (e.g. "doge")
 * name = same as id, formatted (e.g. "Doge")
 * url  = public URL served by Vite (e.g. "./skins/doge.png")
 */
export function getSkinList() {
    return Object.keys(skinModules).map(path => {
        const filename = path.split('/').pop();           // "doge.png"
        const id = filename.replace(/\.[^.]+$/, '');      // "doge"
        const name = id.charAt(0).toUpperCase() + id.slice(1).replace(/[_-]/g, ' ');
        const url = `./skins/${filename}`;                // served from public/
        return { id, name, url };
    }).sort((a, b) => a.name.localeCompare(b.name));
}

