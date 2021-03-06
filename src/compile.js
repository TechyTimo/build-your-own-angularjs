/*jshint globalstrict: true*/
'use strict';

var PREFIX_REGEXP = /(x[\:\-_]|data[\:\-_])/i;
var BOOLEAN_ATTRS = {
  multiple: true,
  selected: true,
  checked: true,
  disabled: true,
  readOnly: true,
  required: true,
  open: true
};
var BOOLEAN_ELEMENTS = {
  INPUT: true,
  SELECT: true,
  OPTION: true,
  TEXTAREA: true,
  BUTTON: true,
  FORM: true,
  DETAILS: true
};

function nodeName(element) {
  return element.nodeName ? element.nodeName : element[0].nodeName;
}

function directiveNormalize(name) {
  return _.camelCase(name.replace(PREFIX_REGEXP, ''));
}

function isBooleanAttribute(node, attrName) {
  return BOOLEAN_ATTRS[attrName] && BOOLEAN_ELEMENTS[node.nodeName];
}

function $CompileProvider($provide) {

  var hasDirectives = {};

  this.directive = function(name, directiveFactory) {
    if (_.isString(name)) {
      if (name === 'hasOwnProperty') {
        throw 'hasOwnProperty is not a valid directive name';
      }
      if (!hasDirectives.hasOwnProperty(name)) {
        hasDirectives[name] = [];
        $provide.factory(name + 'Directive', ['$injector', function($injector) {
          var factories = hasDirectives[name];
          return _.map(factories, function(factory) {
            var directive = $injector.invoke(factory);
            directive.restrict = directive.restrict || 'A';
            return directive;
          });
        }]);
      }
      hasDirectives[name].push(directiveFactory);
    } else {
      _.forEach(name, function(directiveFactory, name) {
        this.directive(name, directiveFactory);
      }, this);
    }
  };

  this.$get = ['$injector', '$rootScope', function($injector, $rootScope) {

    function Attributes(element) {
      this.$$element = element;
      this.$attr = {};
    }

    Attributes.prototype.$observe = function(key, fn) {
      var self = this;
      this.$$observers = this.$$observers || {};
      this.$$observers[key] = this.$$observers[key] || [];
      this.$$observers[key].push(fn);
      $rootScope.$evalAsync(function() {
        fn(self[key]);
      });
      return fn;
    };

    Attributes.prototype.$set = function(key, value, writeAttr, attrName) {
      this[key] = value;

      if (isBooleanAttribute(this.$$element[0], key)) {
        this.$$element.prop(key, value);
      }

      if (!attrName) {
        if (this.$attr[key]) {
          attrName = this.$attr[key];
        } else {
          attrName = this.$attr[key] = _.snakeCase(key);
        }
      } else {
        this.$attr[key] = attrName;
      }

      if (writeAttr !== false) {
        this.$$element.attr(attrName, value);
      }

      if (this.$$observers) {
        _.forEach(this.$$observers[key], function(observer) {
          try {
            observer(value);
          } catch (e) {
            console.log(e);
          }
        });
      }
    };

    Attributes.prototype.$addClass = function(classVal) {
      this.$$element.addClass(classVal);
    };

    Attributes.prototype.$removeClass = function(classVal) {
      this.$$element.removeClass(classVal);
    };

    Attributes.prototype.$updateClass = function(newClassVal, oldClassVal) {
      var newClasses = newClassVal.split(/\s+/);
      var oldClasses = oldClassVal.split(/\s+/);
      var addedClasses = _.difference(newClasses, oldClasses);
      var removedClasses = _.difference(oldClasses, newClasses);
      if (addedClasses.length) {
        this.$addClass(addedClasses.join(' '));
      }
      if (removedClasses.length) {
        this.$removeClass(removedClasses.join(' '));
      }
    };

    function compile($compileNodes) {
      return compileNodes($compileNodes);
    }

    function compileNodes($compileNodes) {
      _.forEach($compileNodes, function(node) {
        var attrs = new Attributes($(node));
        var directives = collectDirectives(node, attrs);
        applyDirectivesToNode(directives, node, attrs);
        if (node.childNodes && node.childNodes.length) {
          compileNodes(node.childNodes);
        }
      });
    }

    function collectDirectives(node, attrs) {
      var directives = [];
      var match;
      if (node.nodeType === Node.ELEMENT_NODE) {
        var normalizedNodeName = directiveNormalize(nodeName(node).toLowerCase());
        addDirective(directives, normalizedNodeName, 'E');
        _.forEach(node.attributes, function(attr) {
          var attrStartName, attrEndName;
          var name = attr.name;
          var normalizedAttrName = directiveNormalize(name.toLowerCase());
          if (/^ngAttr[A-Z]/.test(normalizedAttrName)) {
            name = _.snakeCase(
              normalizedAttrName[6].toLowerCase() +
              normalizedAttrName.substring(7),
              '-'
            );
            normalizedAttrName = directiveNormalize(name.toLowerCase());
          }

          attrs.$attr[normalizedAttrName] = name;

          if (/Start$/.test(normalizedAttrName)) {
            attrStartName = name;
            attrEndName = name.substring(0, name.length - 5) + 'end';
            name = name.substring(0, name.length - 6);
          }
          normalizedAttrName = directiveNormalize(name.toLowerCase());
          addDirective(directives, normalizedAttrName, 'A', attrStartName, attrEndName);
          attrs[normalizedAttrName] = attr.value.trim();
          if (isBooleanAttribute(node, normalizedAttrName)) {
            attrs[normalizedAttrName] = true;
          }

        });
        var className = node.className;
        if (_.isString(className) && !_.isEmpty(className)) {
          while ((match = /([\d\w\-_]+)(?:\:([^;]+))?;?/.exec(className))) {
            var normalizedClassName = directiveNormalize(match[1]);
            if (addDirective(directives, normalizedClassName, 'C')) {
              attrs[normalizedClassName] = match[2] ? match[2].trim() : undefined;
            }
            className = className.substr(match.index + match[0].length);
          }
        }
      } else if (node.nodeType === Node.COMMENT_NODE) {
        match = /^\s*directive\:\s*([\d\w\-_]+)\s*(.*)$/.exec(node.nodeValue);
        if (match) {
          var normalizedName = directiveNormalize(match[1]);
          if (addDirective(directives, normalizedName, 'M')) {
            attrs[normalizedName] = match[2] ? match[2].trim() : undefined;
          }
        }
      }
      return directives;
    }

    function addDirective(directives, name, mode, attrStartName, attrEndName) {
      var match;
      if (hasDirectives.hasOwnProperty(name)) {
        var foundDirectives = $injector.get(name + 'Directive');
        var applicableDirectives = _.filter(foundDirectives, function(dir) {
          return dir.restrict.indexOf(mode) !== -1;
        });
        _.forEach(applicableDirectives, function(directive) {
          if (attrStartName) {
            directive = _.create(directive, {$$start: attrStartName, $$end: attrEndName});
          }
          directives.push(directive);
          match = directive;
        });
      }
      return match;
    }

    function applyDirectivesToNode(directives, compileNode, attrs) {
      var $compileNode = $(compileNode);
      _.forEach(directives, function(directive) {
        if (directive.$$start) {
          $compileNode = groupScan(compileNode, directive.$$start, directive.$$end);
        }
        if (directive.compile) {
          directive.compile($compileNode, attrs);
        }
      });
    }

    function groupScan(node, startAttr, endAttr) {
      var nodes = [];
      if (startAttr && node && node.hasAttribute(startAttr)) {
        var depth = 0;
        do {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.hasAttribute(startAttr)) {
              depth++;
            } else if (node.hasAttribute(endAttr)) {
              depth--;
            }
          }
          nodes.push(node);
          node = node.nextSibling;
        } while (depth > 0);
      } else {
        nodes.push(node);
      }
      return $(nodes);
    }

    return compile;
  }];

}
$CompileProvider.$inject = ['$provide'];
