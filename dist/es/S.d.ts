export interface DataSignal<T> {
    (): T;
    (val: T): T;
}
export declare function comp<T>(fn: (v: T | undefined) => T, value?: T): () => T;
export declare function root<T>(fn: (dispose: () => void) => T): T;
export declare function on<T>(ev: () => any, fn: (v?: T) => T, seed?: T, onchanges?: boolean): () => T;
export declare function effect<T>(fn: (v: T | undefined) => T, value?: T): void;
export declare function data<T>(value: T): (value?: T) => T;
export declare function value<T>(current: T, eq?: (a: T, b: T) => boolean): DataSignal<T>;
export declare function freeze<T>(fn: () => T): T;
export declare function sample<T>(fn: () => T): T;
export declare function cleanup(fn: (final: boolean) => void): void;
export declare function makeDataNode(value: any): DataNode;
export { makeComputationNode };
export interface IClock {
    time(): number;
}
interface INode<T> {
    clock(): IClock;
    current(): T;
}
interface IDataNode<T> extends INode<T> {
    next(value: T): T;
}
export { INode as Node, IDataNode as DataNode, IClock as Clock };
export declare function disposeNode(node: ComputationNode): void;
export declare function isFrozen(): boolean;
export declare function isListening(): boolean;
declare class DataNode {
    value: any;
    pending: any;
    log: Log | null;
    constructor(value: any);
    current(): any;
    next(value: any): any;
    clock(): {
        time: () => number;
    };
}
declare class ComputationNode {
    fn: ((v: any) => any) | null;
    value: any;
    age: number;
    state: number;
    source1: Log | null;
    source1slot: number;
    sources: Log[] | null;
    sourceslots: number[] | null;
    log: Log | null;
    owned: ComputationNode[] | null;
    cleanups: ((final: boolean) => void)[] | null;
    constructor();
    current(): any;
    clock(): {
        time: () => number;
    };
}
declare class Log {
    node1: ComputationNode | null;
    node1slot: number;
    nodes: ComputationNode[] | null;
    nodeslots: number[] | null;
}
declare function makeComputationNode<T>(fn: (v: T | undefined) => T, value: T | undefined, orphan: boolean, sample: boolean): {
    node: ComputationNode | null;
    value: T;
};
