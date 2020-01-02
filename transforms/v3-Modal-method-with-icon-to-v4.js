const {
  parseStrToArray,
  removeEmptyModuleImport,
  addSubmoduleImport,
} = require('./utils');
const { printOptions } = require('./utils/config');
const {
  getV4IconComponentName,
  createIconJSXElement,
} = require('./utils/icon');

const modalMethodNames = ['info', 'success', 'error', 'warning', 'confirm'];

module.exports = (file, api, options) => {
  const j = api.jscodeshift;
  const root = j(file.source);
  const antdPkgNames = parseStrToArray(options.antdPkgNames || 'antd');

  // rename old Model.method() calls with `icon#string` argument
  function renameV3ModalMethodCalls(j, root) {
    let hasChanged = false;
    root
      .find(j.Identifier)
      .filter(
        path =>
          path.node.name === 'Modal' &&
          path.parent.node.type === 'ImportSpecifier' &&
          antdPkgNames.includes(path.parent.parent.node.source.value),
      )
      .forEach(path => {
        const localComponentName = path.parent.node.local.name;
        const antdPkgName = path.parent.parent.node.source.value;

        const paths = root
          .find(j.CallExpression, {
            callee: {
              object: {
                type: 'Identifier',
                name: localComponentName,
              },
              property: {
                type: 'Identifier',
              },
            },
          })
          .filter(nodePath =>
            modalMethodNames.includes(nodePath.node.callee.property.name),
          );

        paths.forEach(nodePath => {
          if (
            !Array.isArray(nodePath.node.arguments) ||
            !nodePath.node.arguments[0] ||
            nodePath.node.arguments[0].type !== 'ObjectExpression'
          ) {
            return;
          }

          const args = nodePath.node.arguments[0];
          const iconProperty = args.properties.find(
            property =>
              property.key.type === 'Identifier' &&
              property.key.name === 'icon',
          );

          // v3-Icon-to-v4-Icon should handle with JSXElement
          if (!iconProperty || iconProperty.value.type === 'JSXElement') {
            return;
          }

          hasChanged = true;

          if (iconProperty.value.type === 'StringLiteral') {
            const v3IconName = iconProperty.value.value;
            const v4IconComponentName = getV4IconComponentName(v3IconName);
            if (v4IconComponentName) {
              const iconJSXElement = createIconJSXElement(
                j,
                v4IconComponentName,
              );
              iconProperty.value = iconJSXElement;

              addSubmoduleImport(j, root, {
                moduleName: '@ant-design/icons',
                importedName: v4IconComponentName,
                before: antdPkgName,
              });
              return;
            } else {
              const location = nodePath.node.loc.start;
              const message =
                'Contains an invalid icon, please check it at https://ant.design/components/icon';
              summary.appendLine(
                `${file.path} - ${location.line}:${location.column}`,
                j(nodePath).toSource(),
                message,
              );
            }
          }

          // handle it with `@ant-design/compatible`
          const typeAttr = j.jsxAttribute(
            j.jsxIdentifier('type'),
            j.jsxExpressionContainer(iconProperty.value),
          );
          const iconJSXElement = createIconJSXElement(j, 'LegacyIcon', [
            typeAttr,
          ]);
          iconProperty.value = iconJSXElement;

          // add @ant-design/compatible imports
          addSubmoduleImport(j, root, {
            moduleName: '@ant-design/compatible',
            importedName: 'Icon',
            localName: 'LegacyIcon',
            before: antdPkgName,
          });
        });
      });

    return hasChanged;
  }

  // step1. // rename old Model.method() calls
  // step2. cleanup antd import if empty
  let hasChanged = false;
  hasChanged = renameV3ModalMethodCalls(j, root) || hasChanged;

  if (hasChanged) {
    antdPkgNames.forEach(antdPkgName => {
      removeEmptyModuleImport(j, root, antdPkgName);
    });
  }

  return hasChanged
    ? root.toSource(options.printOptions || printOptions)
    : null;
};
