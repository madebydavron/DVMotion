"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchAll = patchAll;
const api_1 = require("../../api");
function getGetter(obj, prop) {
    while (obj) {
        const getter = Object.getOwnPropertyDescriptor(obj, prop);
        if (getter && getter.get) {
            return getter.get;
        }
        obj = Object.getPrototypeOf(obj);
    }
}
function getSetter(obj, prop) {
    while (obj) {
        const setter = Object.getOwnPropertyDescriptor(obj, prop);
        if (setter && setter.set) {
            return setter.set;
        }
        obj = Object.getPrototypeOf(obj);
    }
}
function getInstanceMethods(obj) {
    const keys = {
        methods: new Set(),
        setters: new Set(),
        getters: new Set(),
    };
    let topObject = obj;
    const mapAllMethods = (property) => {
        const getter = getGetter(topObject, property);
        const setter = getSetter(topObject, property);
        if (getter) {
            keys.getters.add(property);
        }
        else if (setter) {
            keys.setters.add(property);
        }
        else if (property !== "constructor") {
            keys.methods.add(property);
        }
    };
    do {
        Object.getOwnPropertyNames(obj).map(mapAllMethods);
        obj = Object.getPrototypeOf(obj);
    } while (obj && Object.getPrototypeOf(obj));
    return keys;
}
function patchClass(clazz, source) {
    const { getters, setters, methods } = getInstanceMethods(source.prototype);
    for (const getter of getters) {
        Object.defineProperty(clazz.prototype, getter, {
            get: getGetter(source.prototype, getter),
        });
    }
    for (const setter of setters) {
        Object.defineProperty(clazz.prototype, setter, {
            set: getSetter(source.prototype, setter),
        });
    }
    for (const method of methods) {
        clazz.prototype[method] = source.prototype[method];
    }
}
function patchAll(source) {
    patchClass(api_1.Api.Message, source);
    patchClass(api_1.Api.MessageService, source);
    patchClass(api_1.Api.MessageEmpty, source);
}
