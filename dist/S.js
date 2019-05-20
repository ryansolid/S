(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (factory((global.S = {})));
}(this, (function (exports) { 'use strict';

    // Public interface
    function comp(fn, value) {
        if (Owner === null)
            console.warn("computations created without a root or parent will never be disposed");
        var { node, value: _value } = makeComputationNode(fn, value, false, false);
        if (node === null) {
            return function computation() { return _value; };
        }
        else {
            return function computation() {
                return node.current();
            };
        }
    }
    function root(fn, detachedOwner) {
        var owner = Owner || detachedOwner || null, disposer = fn.length === 0 ? null : function _dispose() {
            if (root === null) ;
            else if (RunningClock !== null) {
                RootClock.disposes.add(root);
            }
            else {
                dispose(root);
            }
        }, root = disposer === null ? UNOWNED : getCandidateNode(), result;
        Owner = root;
        try {
            result = disposer === null ? fn() : fn(disposer);
        }
        finally {
            Owner = owner;
        }
        if (disposer !== null && recycleOrClaimNode(root, null, undefined, true)) {
            root = null;
        }
        return result;
    }
    function on(ev, fn, seed, onchanges) {
        if (Array.isArray(ev))
            ev = callAll(ev);
        onchanges = !!onchanges;
        return comp(on, seed);
        function on(value) {
            var listener = Listener;
            ev();
            if (onchanges)
                onchanges = false;
            else {
                Listener = null;
                value = fn(value);
                Listener = listener;
            }
            return value;
        }
    }
    function callAll(ss) {
        return function all() {
            for (var i = 0; i < ss.length; i++)
                ss[i]();
        };
    }
    function effect(fn, value) {
        makeComputationNode(fn, value, false, false);
    }
    function data(value) {
        var node = new DataNode(value);
        return function data(value) {
            if (arguments.length === 0) {
                return node.current();
            }
            else {
                return node.next(value);
            }
        };
    }
    function value(current, eq) {
        var node = new DataNode(current), age = -1;
        return function value(update) {
            if (arguments.length === 0) {
                return node.current();
            }
            else {
                var same = eq ? eq(current, update) : current === update;
                if (!same) {
                    var time = RootClock.time;
                    if (age === time)
                        throw new Error("conflicting values: " + update + " is not the same as " + current);
                    age = time;
                    current = update;
                    node.next(update);
                }
                return update;
            }
        };
    }
    function freeze(fn) {
        var result = undefined;
        if (RunningClock !== null) {
            result = fn();
        }
        else {
            RunningClock = RootClock;
            RunningClock.changes.reset();
            try {
                result = fn();
                event();
            }
            finally {
                RunningClock = null;
            }
        }
        return result;
    }
    function sample(fn) {
        var result, listener = Listener;
        Listener = null;
        result = fn();
        Listener = listener;
        return result;
    }
    function cleanup(fn) {
        if (Owner === null)
            console.warn("cleanups created without a root or parent will never be run");
        else if (Owner.cleanups === null)
            Owner.cleanups = [fn];
        else
            Owner.cleanups.push(fn);
    }
    // experimental : exposing node constructors and some state
    function makeDataNode(value) {
        return new DataNode(value);
    }
    function disposeNode(node) {
        if (RunningClock !== null) {
            RootClock.disposes.add(node);
        }
        else {
            dispose(node);
        }
    }
    function isFrozen() {
        return RunningClock !== null;
    }
    function isListening() {
        return Listener !== null;
    }
    // context API
    function getContextOwner() {
        return Owner;
    }
    // export function setContext(key: symbol | string, value: any) {
    //   if (Owner === null) return console.warn("Context keys cannot be set without a root or parent");
    //   const context = Owner.context || (Owner.context = {});
    //   context[key] = value;
    // }
    // export function lookupContext(key: symbol | string) {
    //   if (Owner === null) return console.warn("Context keys cannot be looked up without a root or parent");
    //   return lookup(Owner, key);
    // }
    // Internal implementation
    /// Graph classes and operations
    class Clock {
        constructor() {
            this.time = 0;
            this.changes = new Queue(); // batched changes to data nodes
            this.updates = new Queue(); // computations to update
            this.disposes = new Queue(); // disposals to run after current batch of updates finishes
        }
    }
    var RootClockProxy = {
        time: function () { return RootClock.time; }
    };
    class DataNode {
        constructor(value) {
            this.value = value;
            this.pending = NOTPENDING;
            this.log = null;
        }
        current() {
            if (Listener !== null) {
                logDataRead(this);
            }
            return this.value;
        }
        next(value) {
            if (RunningClock !== null) {
                if (this.pending !== NOTPENDING) { // value has already been set once, check for conflicts
                    if (value !== this.pending) {
                        throw new Error("conflicting changes: " + value + " !== " + this.pending);
                    }
                }
                else { // add to list of changes
                    this.pending = value;
                    RootClock.changes.add(this);
                }
            }
            else { // not batching, respond to change now
                if (this.log !== null) {
                    this.pending = value;
                    RootClock.changes.add(this);
                    event();
                }
                else {
                    this.value = value;
                }
            }
            return value;
        }
        clock() {
            return RootClockProxy;
        }
    }
    class ComputationNode {
        constructor() {
            this.fn = null;
            this.value = undefined;
            // context = undefined as any;
            this.age = -1;
            this.state = CURRENT;
            this.source1 = null;
            this.source1slot = 0;
            this.sources = null;
            this.sourceslots = null;
            this.log = null;
            // owner = Owner;
            this.owned = null;
            this.cleanups = null;
        }
        current() {
            if (Listener !== null) {
                if (this.age === RootClock.time) {
                    if (this.state === RUNNING)
                        throw new Error("circular dependency");
                    else
                        updateNode(this); // checks for state === STALE internally, so don't need to check here
                }
                logComputationRead(this);
            }
            return this.value;
        }
        clock() {
            return RootClockProxy;
        }
    }
    class Log {
        constructor() {
            this.node1 = null;
            this.node1slot = 0;
            this.nodes = null;
            this.nodeslots = null;
        }
    }
    class Queue {
        constructor() {
            this.items = [];
            this.count = 0;
        }
        reset() {
            this.count = 0;
        }
        add(item) {
            this.items[this.count++] = item;
        }
        run(fn) {
            var items = this.items;
            for (var i = 0; i < this.count; i++) {
                fn(items[i]);
                items[i] = null;
            }
            this.count = 0;
        }
    }
    // Constants
    var NOTPENDING = {}, CURRENT = 0, STALE = 1, RUNNING = 2, UNOWNED = new ComputationNode();
    // "Globals" used to keep track of current system state
    var RootClock = new Clock(), RunningClock = null, // currently running clock 
    Listener = null, // currently listening computation
    Owner = null, // owner for new computations
    LastNode = null; // cached unused node, for re-use
    // Functions
    // function lookup(owner: ComputationNode, key: symbol | string): any {
    //   return (owner && owner.context && owner.context[key]) || (owner.owner && lookup(owner.owner, key));
    // }
    var makeComputationNodeResult = { node: null, value: undefined };
    function makeComputationNode(fn, value, orphan, sample) {
        var node = getCandidateNode(), owner = Owner, listener = Listener, toplevel = RunningClock === null;
        Owner = node;
        Listener = sample ? null : node;
        if (toplevel) {
            value = execToplevelComputation(fn, value);
        }
        else {
            value = fn(value);
        }
        Owner = owner;
        Listener = listener;
        var recycled = recycleOrClaimNode(node, fn, value, orphan);
        if (toplevel)
            finishToplevelComputation(owner, listener);
        makeComputationNodeResult.node = recycled ? null : node;
        makeComputationNodeResult.value = value;
        return makeComputationNodeResult;
    }
    function execToplevelComputation(fn, value) {
        RunningClock = RootClock;
        RootClock.changes.reset();
        RootClock.updates.reset();
        try {
            return fn(value);
        }
        finally {
            Owner = Listener = RunningClock = null;
        }
    }
    function finishToplevelComputation(owner, listener) {
        if (RootClock.changes.count > 0 || RootClock.updates.count > 0) {
            RootClock.time++;
            try {
                run(RootClock);
            }
            finally {
                RunningClock = null;
                Owner = owner;
                Listener = listener;
            }
        }
    }
    function getCandidateNode() {
        var node = LastNode;
        if (node === null)
            node = new ComputationNode();
        else
            LastNode = null;
        return node;
    }
    function recycleOrClaimNode(node, fn, value, orphan) {
        var _owner = orphan || Owner === null || Owner === UNOWNED ? null : Owner, recycle = node.source1 === null && (node.owned === null && node.cleanups === null || _owner !== null), i;
        if (recycle) {
            LastNode = node;
            if (_owner !== null) {
                if (node.owned !== null) {
                    if (_owner.owned === null)
                        _owner.owned = node.owned;
                    else
                        for (i = 0; i < node.owned.length; i++) {
                            _owner.owned.push(node.owned[i]);
                        }
                    node.owned = null;
                }
                if (node.cleanups !== null) {
                    if (_owner.cleanups === null)
                        _owner.cleanups = node.cleanups;
                    else
                        for (i = 0; i < node.cleanups.length; i++) {
                            _owner.cleanups.push(node.cleanups[i]);
                        }
                    node.cleanups = null;
                }
            }
        }
        else {
            node.fn = fn;
            node.value = value;
            node.age = RootClock.time;
            if (_owner !== null) {
                if (_owner.owned === null)
                    _owner.owned = [node];
                else
                    _owner.owned.push(node);
            }
        }
        return recycle;
    }
    function logRead(from) {
        var to = Listener, fromslot, toslot = to.source1 === null ? -1 : to.sources === null ? 0 : to.sources.length;
        if (from.node1 === null) {
            from.node1 = to;
            from.node1slot = toslot;
            fromslot = -1;
        }
        else if (from.nodes === null) {
            from.nodes = [to];
            from.nodeslots = [toslot];
            fromslot = 0;
        }
        else {
            fromslot = from.nodes.length;
            from.nodes.push(to);
            from.nodeslots.push(toslot);
        }
        if (to.source1 === null) {
            to.source1 = from;
            to.source1slot = fromslot;
        }
        else if (to.sources === null) {
            to.sources = [from];
            to.sourceslots = [fromslot];
        }
        else {
            to.sources.push(from);
            to.sourceslots.push(fromslot);
        }
    }
    function logDataRead(data) {
        if (data.log === null)
            data.log = new Log();
        logRead(data.log);
    }
    function logComputationRead(node) {
        if (node.log === null)
            node.log = new Log();
        logRead(node.log);
    }
    function event() {
        // b/c we might be under a top level S.root(), have to preserve current root
        var owner = Owner;
        RootClock.updates.reset();
        RootClock.time++;
        try {
            run(RootClock);
        }
        finally {
            RunningClock = Listener = null;
            Owner = owner;
        }
    }
    function run(clock) {
        var running = RunningClock, count = 0;
        RunningClock = clock;
        clock.disposes.reset();
        // for each batch ...
        while (clock.changes.count !== 0 || clock.updates.count !== 0 || clock.disposes.count !== 0) {
            if (count > 0) // don't tick on first run, or else we expire already scheduled updates
                clock.time++;
            clock.changes.run(applyDataChange);
            clock.updates.run(updateNode);
            clock.disposes.run(dispose);
            // if there are still changes after excessive batches, assume runaway            
            if (count++ > 1e5) {
                throw new Error("Runaway clock detected");
            }
        }
        RunningClock = running;
    }
    function applyDataChange(data) {
        data.value = data.pending;
        data.pending = NOTPENDING;
        if (data.log)
            markComputationsStale(data.log);
    }
    function markComputationsStale(log) {
        var node1 = log.node1, nodes = log.nodes;
        // mark all downstream nodes stale which haven't been already
        if (node1 !== null)
            markNodeStale(node1);
        if (nodes !== null) {
            for (var i = 0, len = nodes.length; i < len; i++) {
                markNodeStale(nodes[i]);
            }
        }
    }
    function markNodeStale(node) {
        var time = RootClock.time;
        if (node.age < time) {
            node.age = time;
            node.state = STALE;
            RootClock.updates.add(node);
            if (node.owned !== null)
                markOwnedNodesForDisposal(node.owned);
            if (node.log !== null)
                markComputationsStale(node.log);
        }
    }
    function markOwnedNodesForDisposal(owned) {
        for (var i = 0; i < owned.length; i++) {
            var child = owned[i];
            child.age = RootClock.time;
            child.state = CURRENT;
            if (child.owned !== null)
                markOwnedNodesForDisposal(child.owned);
        }
    }
    function updateNode(node) {
        if (node.state === STALE) {
            var owner = Owner, listener = Listener;
            Owner = Listener = node;
            node.state = RUNNING;
            cleanupNode(node, false);
            node.value = node.fn(node.value);
            node.state = CURRENT;
            Owner = owner;
            Listener = listener;
        }
    }
    function cleanupNode(node, final) {
        var source1 = node.source1, sources = node.sources, sourceslots = node.sourceslots, cleanups = node.cleanups, owned = node.owned, i, len;
        if (cleanups !== null) {
            for (i = 0; i < cleanups.length; i++) {
                cleanups[i](final);
            }
            node.cleanups = null;
        }
        if (owned !== null) {
            for (i = 0; i < owned.length; i++) {
                dispose(owned[i]);
            }
            node.owned = null;
        }
        if (source1 !== null) {
            cleanupSource(source1, node.source1slot);
            node.source1 = null;
        }
        if (sources !== null) {
            for (i = 0, len = sources.length; i < len; i++) {
                cleanupSource(sources.pop(), sourceslots.pop());
            }
        }
    }
    function cleanupSource(source, slot) {
        var nodes = source.nodes, nodeslots = source.nodeslots, last, lastslot;
        if (slot === -1) {
            source.node1 = null;
        }
        else {
            last = nodes.pop();
            lastslot = nodeslots.pop();
            if (slot !== nodes.length) {
                nodes[slot] = last;
                nodeslots[slot] = lastslot;
                if (lastslot === -1) {
                    last.source1slot = slot;
                }
                else {
                    last.sourceslots[lastslot] = slot;
                }
            }
        }
    }
    function dispose(node) {
        node.fn = null;
        node.log = null;
        cleanupNode(node, true);
    }

    exports.comp = comp;
    exports.root = root;
    exports.on = on;
    exports.effect = effect;
    exports.data = data;
    exports.value = value;
    exports.freeze = freeze;
    exports.sample = sample;
    exports.cleanup = cleanup;
    exports.makeDataNode = makeDataNode;
    exports.makeComputationNode = makeComputationNode;
    exports.disposeNode = disposeNode;
    exports.isFrozen = isFrozen;
    exports.isListening = isListening;
    exports.getContextOwner = getContextOwner;

    Object.defineProperty(exports, '__esModule', { value: true });

})));
