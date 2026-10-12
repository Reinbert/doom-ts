import fs from 'node:fs';
import path from 'node:path';

function resolveGlslIncludes(filePath, content, visited = new Set()) {
  if (visited.has(filePath)) {
    return '';
  }
  visited.add(filePath);

  const dir = path.dirname(filePath);
  const includeRegex = /^[ \t]*#include\s+([./][^\r\n>]+)/gm;

  return content.replace(includeRegex, (match, includePath) => {
    includePath = includePath.trim();
    let targetPath = path.resolve(dir, includePath);
    if (!fs.existsSync(targetPath)) {
      if (fs.existsSync(targetPath + '.glsl')) {
        targetPath = targetPath + '.glsl';
      }
    }
    if (fs.existsSync(targetPath)) {
      const includeContent = fs.readFileSync(targetPath, 'utf-8');
      return resolveGlslIncludes(targetPath, includeContent, new Set(visited));
    }
    return match;
  });
}

export default {
  name: 'glsl-loader',
  setup(build) {
    build.onLoad({ filter: /\.(glsl|vert|frag)$/ }, async (args) => {
      const source = await fs.promises.readFile(args.path, 'utf8');
      const contents = resolveGlslIncludes(args.path, source);
      return {
        contents,
        loader: 'text',
      };
    });
  },
};
