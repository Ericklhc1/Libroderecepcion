import { readFileSync } from 'node:fs';
import { Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import AppTemplate from '@/app/(app)/template';

function parse(file: string) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function jsxElements(source: ts.SourceFile) {
  const elements: ts.JsxElement[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node)) elements.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return elements;
}

describe('fronteras estables de contenido de ruta transmitido', () => {
  it('el template da a sus hijos un Fragment con clave fija, conservando referencia y HTML', () => {
    const child = <section id="route-child"><input defaultValue="Borrador local" /></section>;
    const first = AppTemplate({ children: child });
    const second = AppTemplate({ children: <section>Otra ruta</section> });
    expect(first.props.children.type).toBe(Fragment);
    expect(first.props.children.key).toBe('aroh-template-content');
    expect(second.props.children.key).toBe(first.props.children.key);
    expect(first.props.children.props.children).toBe(child);
    expect(renderToStaticMarkup(first)).toBe(renderToStaticMarkup(<div className="surface-enter min-w-0">{child}</div>));
  });

  it('main contiene sólo la frontera literal de ruta y no reinicia el shell por URL', () => {
    const source = parse('src/app/(app)/layout.tsx');
    const elements = jsxElements(source);
    const main = elements.find(node => node.openingElement.tagName.getText(source) === 'main')!;
    expect(main).toBeDefined();
    const fragments = elements.filter(node => node.openingElement.tagName.getText(source) === 'Fragment');
    expect(fragments).toHaveLength(1);
    const fragment = fragments[0]!;
    expect(fragment.parent).toBe(main);
    const key = fragment.openingElement.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(source) === 'key');
    expect(key && ts.isJsxAttribute(key) && key.initializer && ts.isStringLiteral(key.initializer) ? key.initializer.text : null).toBe('aroh-route-content');
    const child = fragment.children.find(ts.isJsxExpression);
    expect(child?.expression?.getText(source)).toBe('children');
    expect(main.getText(source)).not.toContain('ReceptionAssistant');
    expect(source.text.indexOf('<ReceptionAssistant')).toBeGreaterThan(main.end);
    expect(source.text).not.toMatch(/key=\{(?:pathname|route|search|Date|Math)/);
  });

  it('el root conserva AppearanceProvider como componente y no agrega otra frontera ni suppress', () => {
    const source = parse('src/app/layout.tsx');
    const elements = jsxElements(source);
    const body = elements.find(node => node.openingElement.tagName.getText(source) === 'body')!;
    const directChild = body.children.find(ts.isJsxElement)!;
    expect(directChild.openingElement.tagName.getText(source)).toBe('AppearanceProvider');
    expect(source.text).not.toContain('<Fragment');
    expect(source.text.match(/suppressHydrationWarning/g)).toHaveLength(1);
  });
});
