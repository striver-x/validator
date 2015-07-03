// 1. 验证选项支持随时添加或删除
// 2. 支持一个字段多个验证规则，不同的规则可以设置不同的错误信息
// 3. 支持手动触发验证
// 4. 支持自定义提交方式
// 5. 支持监听字段验证的成功或失败
// 6. 支持临时禁止某个字段的验证，而后可以再次激活
// 7. 能获取form所有或单个字段数据
// 8. 支持异步验证

(function(global, factory) {
    'use strict';

    global.validator = factory(global.jQuery || global.Zepto || global.$);

})(this, function($) {
    'use strict';

    //
    var Events = {
                
        listen: function(name, callback) {
            var events = {};
            
            if (typeof name === 'string') {
                events[name] = callback;
            } else {
                events = name;
                name = null;
            }

            forEach(events, function(name, callback) {
                var _events = this._events[name] || [];
                _events.push(callback);
                this._events[name] = _events;
            }, this);
        },
        
        trigger: function(name) {
            var events = this._events[name] || [],
                args = Array.prototype.slice.call(arguments, 1),
                l = events.length, i, callback, ret;
            
            for (i = 0; i < l; i++) {
                callback = events[i];
                if (typeof callback === 'string') {
                    callback = this[callback];
                }
                ret = callback.apply(this, args);    
            }

            return ret;
        }
    };

    //
    var V = function(options) {

        this.$form = $(options.formSelector);

        this.addField(options.fields);

        this.listen(options.events);
        
        this.$form.attr('novalidate', 'novalidate');

        this.$form.on('submit', $.proxy(this.fireValidate, this));
    }

    // 基础属性和方法
    $.extend(V.prototype, Events, {

        _events: [],

        // 每个字段的实例
        fields: {},

        // 是否自动提交
        autoSubmit: false,
        
        // 添加验证字段
        addField: function(name, options) {
            var _options = {};
            
            if (typeof name === 'string') {
                _options[name] = options;            
            } else {
                _options = name;
            }

            for (name in _options) {
                _options[name].V = this;
                _options[name].$form = this.$form;
                this.fields[name] = new Field(name, _options[name]);
            }
        },

        fireValidate: function (name) {
            var fields = this.fields, 
                deferred = [], context = this;

            if (name && name in fields) {
                return fields[name].validate();
            }
            
            for (name in fields) {
                deferred.concat(fields[name].validate());
            }

            $.when.apply(null, deferred).then(
                function() {
                    var noValidCount = 0;

                    for (name in fields) {
                        noValidCount += !fields[name].isValid * 1;
                    }

                    if (noValidCount === 0) {
                        // 触发表单
                        context.trigger('beforeSubmit');
                        // 提交表单
                        if (context.autoSubmit) {
                            context.$form[0].submit();
                        } 
                    } else {
                        // context.validateError();
                    }
                },
                function() {
                    //context.validateError();
                }
            );

            return false;
        },

        // 用于扩展方法
        extend: function(options) {
            $.extend(this, options);
        }
    });

    // 扩展辅助方法
    $.extend(V.protoype, {

        delField: function(name) {
            var fields = this.fields, i;
            name = name.split(' ');
            for (i = 0; i < name.length; i++) {
                delete fields[name[i]];
            }
        },

        disableField: function(name) {
            this.toggleDisable(name, true);
        },

        enableField: function(name) {
            this.toggleDisable(name, false);
        },

        toggleDisable: function(name, value) {
            var fields = this.fields, i, _name;
            name = name.split(' ');
            for (i = 0; (_name = name[i]) !== undefined; i++) {
                if (_name in fields) {
                    fields[_name].isDisable = value;
                }
            }
        },

        getFormData: function(name) {
            var fields = this.fields, ret = {};
            if (name && name in fields) {
                return fields[name].$node.val();
            } else {
                foreach(fields, function(name, field) {
                    ret[name] = field.$node.val();
                }, this);
            }
            return ret;
        }

    });

    //
    var Field = function(name, options) {

        this.$node = $('[name='+ name +']', options.$form);
        this.nodeType = getNodeType(this.$node);
        this.fieldName = name;

        this.parseRule(options.rules);

        forEach('checkEmpty message messageTo isDisable required serverCallback V $form'.split(' '), function(k, name) {
            this[name] = options[name];
        }, this);
        
    };    

    $.extend(Field.prototype, Events, {
        // 字段DOM对象
        $node: null,
        // 字段类型
        elType: '',
        // 验证规则
        rules: [],
        // 字段名
        fieldName: '',
        // 为空时是否检测
        checkEmpty: false,
        // 错误信息
        message: '',
        // 错误信息显示位置
        messageTo: '',
        // 验证结果，默认为true
        isValid: true,
        // 是否取消验证
        isDisable: false,
        // 是否必须
        required: true,

        _events: [],

        validate: function() {
            var _this = this, 
                deferred = [],
                val = this.$node.val();

                // 跳过手动取消验证的
            if (this.isDisable || 
                // 跳过值为空时，并且不是必须的或不检查空值
                (val === '' && (!this.required || !this.checkEmpty)) || 
                // 跳过没有任何验证规则的
                this.rules === '') {
                
                return [];
            }

            forEach(this.rules, function(k, rule) {

                var handler = rule.handler, ret;

                if (typeof handler === 'string') {
                    ret = this[handler](rule.option, val);
                } else {
                    ret = handler.call(this, val);
                }

                if (ret === false) {
                    this.validateError(k);
                    return false;
                } 

                if (isDeferred(ret)) {
                    deferred.push(ret);   

                    $.when(ret).fail(function() {
                        this.validateError(k);

                    }).done(function(resp) {
                        if (!_this.serverCallback(resp)) {
                            this.validateError(k);
                        }
                    });
                }

            }, this);

            $.when.apply(null, deferred).done(function() {
                if (_this.isValid === true) {
                    _this.validateSuccess();
                }
            });

            return deferred;
        },

        validateError: function(k) {
            this.isValid = false;
            this.V.trigger('error:'+ this.fieldName);
            this.V.trigger('error', this);
        },

        validateSuccess: function() {
            this.isValid = true;
        },

        serverCallback: function() {
            return true;
        },

        parseRule: function(options) {
            
            if (!$.isArray(options)) {
                options = [options];
            }

            forEach(options, function(k, obj) {
            
                var t = $.type(obj), ret = {};

                // 正则
                if (t === 'regexp') {
                    ret.handler = 'regexp';
                    ret.option = obj;

                // 自定义函数
                } else if (t === 'function') {
                    ret.handler = obj;
                    ret.option = '';

                } else if (t === 'string') {
                    // 比对
                    if (obj.indexOf('confirm') === 0) {
                        ret.handler = 'confirm';
                        ret.option = $(obj.split(' ')[1], this.$form);

                    // 异步服务器校验
                    } else if (obj.indexOf('server') === 0) {
                        ret.handler = 'server';
                        ret.option = obj.split(' ')[1];

                    } else {
                        ret.handler = 'equal';
                        ret.option = obj;    
                    } 

                } else {
                    ret.handler = 'equal';
                    ret.option = obj;
                }

                this.rules.push(ret);

            }, this); 

        }

    });

    // 通用验证方法
    $.extend(Field.prototype, {
        // 正则表达式校验
        regexp: function(option, val) {
            return option.test(val);
        },
        // 相等校验
        equal: function(option, val) {
            return option === val;
        },
        // 二次输入是否一致校验
        confirm: function(option, val) {
            return option.val() === val;
        },
        // 异步校验
        // 返回一个延迟对象
        server: function(val, option) {
            return $.ajax({

            });
        }
    });

    function isDeferred(obj) {
        return obj && typeof obj.promise === 'function';
    }

    function forEach(obj, callback, context) {
        if (context) {
            return $.each(obj, $.proxy(callback, context));
        } else {
            return $.each(obj, callback);
        }
    }

    function getNodeType($node) {
        var tagName = $node[0].tagName.toUpperCase();
        return tagName === 'INPUT' ? $node.attr('type') : tagName ;
    }

    return V;
});


















