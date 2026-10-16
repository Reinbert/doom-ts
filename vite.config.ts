import { defineConfig } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import dts from 'vite-plugin-dts'

function resolveGlslIncludes(filePath: string, content: string, visited = new Set<string>()): string {
  if (visited.has(filePath)) {
    return ''
  }
  visited.add(filePath)

  const dir = path.dirname(filePath)
  const includeRegex = /^[ \t]*#include\s+([./][^\r\n>]+)/gm

  return content.replace(includeRegex, (match, includePath) => {
    includePath = includePath.trim()
    let targetPath = path.resolve(dir, includePath)
    if (!fs.existsSync(targetPath)) {
      if (fs.existsSync(targetPath + '.glsl')) {
        targetPath = targetPath + '.glsl'
      }
    }
    if (fs.existsSync(targetPath)) {
      const includeContent = fs.readFileSync(targetPath, 'utf-8')
      return resolveGlslIncludes(targetPath, includeContent, new Set(visited))
    }
    return match
  })
}

function glslPlugin(): import('vite').Plugin {
  return {
    name: 'vite-plugin-glsl-loader',
    transform(code, id) {
      if (/\.(glsl|vert|frag)$/i.test(id)) {
        const filePath = id.split('?')[0]
        const transformed = resolveGlslIncludes(filePath, code)
        return {
          code: `export default ${JSON.stringify(transformed)};`,
          map: { mappings: '' },
        }
      }
    },
  }
}

function copyPublicPlugin(): import('vite').Plugin {
  return {
    name: 'copy-public-to-dist-public',
    closeBundle() {
      const srcDir = fileURLToPath(new URL('./public', import.meta.url))
      const destDir = fileURLToPath(new URL('./dist/public', import.meta.url))
      if (fs.existsSync(srcDir)) {
        fs.cpSync(srcDir, destDir, { recursive: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [
    glslPlugin(),
    copyPublicPlugin(),
    dts({
      rollupTypes: true,
      tsconfigPath: './tsconfig.json',
    }),
  ],
  build: {
    copyPublicDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'Doom',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      external: [
        'three',
        'dexie',
        'lil-gui',
        'smplr',
        'stats.js',
      ],
      output: {
        globals: {
          three: 'THREE',
          dexie: 'Dexie',
          'lil-gui': 'GUI',
          smplr: 'smplr',
          'stats.js': 'Stats',
        },
      },
    },
  },
})
