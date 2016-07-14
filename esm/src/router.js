/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/mergeMap';
import 'rxjs/add/operator/mergeAll';
import 'rxjs/add/operator/reduce';
import 'rxjs/add/operator/every';
import 'rxjs/add/observable/from';
import 'rxjs/add/observable/fromPromise';
import 'rxjs/add/observable/forkJoin';
import 'rxjs/add/observable/of';
import { ComponentFactoryResolver, ReflectiveInjector } from '@angular/core';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import { applyRedirects } from './apply_redirects';
import { validateConfig } from './config';
import { createRouterState } from './create_router_state';
import { createUrlTree } from './create_url_tree';
import { recognize } from './recognize';
import { resolve } from './resolve';
import { RouterConfigLoader } from './router_config_loader';
import { RouterOutletMap } from './router_outlet_map';
import { ActivatedRoute, advanceActivatedRoute, createEmptyState } from './router_state';
import { PRIMARY_OUTLET } from './shared';
import { UrlTree, createEmptyUrlTree } from './url_tree';
import { forEach, merge, shallowEqual, waitForMap } from './utils/collection';
/**
 * An event triggered when a navigation starts
 *
 * @stable
 */
export class NavigationStart {
    constructor(id, url) {
        this.id = id;
        this.url = url;
    }
    toString() { return `NavigationStart(id: ${this.id}, url: '${this.url}')`; }
}
/**
 * An event triggered when a navigation ends successfully
 *
 * @stable
 */
export class NavigationEnd {
    constructor(id, url, urlAfterRedirects) {
        this.id = id;
        this.url = url;
        this.urlAfterRedirects = urlAfterRedirects;
    }
    toString() {
        return `NavigationEnd(id: ${this.id}, url: '${this.url}', urlAfterRedirects: '${this.urlAfterRedirects}')`;
    }
}
/**
 * An event triggered when a navigation is canceled
 *
 * @stable
 */
export class NavigationCancel {
    constructor(id, url) {
        this.id = id;
        this.url = url;
    }
    toString() { return `NavigationCancel(id: ${this.id}, url: '${this.url}')`; }
}
/**
 * An event triggered when a navigation fails due to unexpected error
 *
 * @stable
 */
export class NavigationError {
    constructor(id, url, error) {
        this.id = id;
        this.url = url;
        this.error = error;
    }
    toString() {
        return `NavigationError(id: ${this.id}, url: '${this.url}', error: ${this.error})`;
    }
}
/**
 * An event triggered when routes are recognized
 *
 * @stable
 */
export class RoutesRecognized {
    constructor(id, url, urlAfterRedirects, state) {
        this.id = id;
        this.url = url;
        this.urlAfterRedirects = urlAfterRedirects;
        this.state = state;
    }
    toString() {
        return `RoutesRecognized(id: ${this.id}, url: '${this.url}', urlAfterRedirects: '${this.urlAfterRedirects}', state: ${this.state})`;
    }
}
/**
 * The `Router` is responsible for mapping URLs to components.
 *
 * See {@link Routes} for more details and examples.
 *
 * @stable
 */
export class Router {
    /**
     * Creates the router service.
     */
    constructor(rootComponentType, resolver, urlSerializer, outletMap, location, injector, loader, config) {
        this.rootComponentType = rootComponentType;
        this.resolver = resolver;
        this.urlSerializer = urlSerializer;
        this.outletMap = outletMap;
        this.location = location;
        this.injector = injector;
        this.navigationId = 0;
        this.resetConfig(config);
        this.routerEvents = new Subject();
        this.currentUrlTree = createEmptyUrlTree();
        this.configLoader = new RouterConfigLoader(loader);
        this.currentRouterState = createEmptyState(this.currentUrlTree, this.rootComponentType);
    }
    /**
     * @internal
     */
    initialNavigation() {
        this.setUpLocationChangeListener();
        this.navigateByUrl(this.location.path(true));
    }
    /**
     * Returns the current route state.
     */
    get routerState() { return this.currentRouterState; }
    /**
     * Returns the current url.
     */
    get url() { return this.serializeUrl(this.currentUrlTree); }
    /**
     * Returns an observable of route events
     */
    get events() { return this.routerEvents; }
    /**
     * Resets the configuration used for navigation and generating links.
     *
     * ### Usage
     *
     * ```
     * router.resetConfig([
     *  { path: 'team/:id', component: TeamCmp, children: [
     *    { path: 'simple', component: SimpleCmp },
     *    { path: 'user/:name', component: UserCmp }
     *  ] }
     * ]);
     * ```
     */
    resetConfig(config) {
        validateConfig(config);
        this.config = config;
    }
    /**
     * @internal
     */
    dispose() { this.locationSubscription.unsubscribe(); }
    /**
     * Applies an array of commands to the current url tree and creates
     * a new url tree.
     *
     * When given an activate route, applies the given commands starting from the route.
     * When not given a route, applies the given command starting from the root.
     *
     * ### Usage
     *
     * ```
     * // create /team/33/user/11
     * router.createUrlTree(['/team', 33, 'user', 11]);
     *
     * // create /team/33;expand=true/user/11
     * router.createUrlTree(['/team', 33, {expand: true}, 'user', 11]);
     *
     * // you can collapse static fragments like this
     * router.createUrlTree(['/team/33/user', userId]);
     *
     * // create /team/33/(user/11//aux:chat)
     * router.createUrlTree(['/team', 33, {outlets: {"": 'user/11', right: 'chat'}}]);
     *
     * // assuming the current url is `/team/33/user/11` and the route points to `user/11`
     *
     * // navigate to /team/33/user/11/details
     * router.createUrlTree(['details'], {relativeTo: route});
     *
     * // navigate to /team/33/user/22
     * router.createUrlTree(['../22'], {relativeTo: route});
     *
     * // navigate to /team/44/user/22
     * router.createUrlTree(['../../team/44/user/22'], {relativeTo: route});
     * ```
     */
    createUrlTree(commands, { relativeTo, queryParams, fragment } = {}) {
        const a = relativeTo ? relativeTo : this.routerState.root;
        return createUrlTree(a, this.currentUrlTree, commands, queryParams, fragment);
    }
    /**
     * Navigate based on the provided url. This navigation is always absolute.
     *
     * Returns a promise that:
     * - is resolved with 'true' when navigation succeeds
     * - is resolved with 'false' when navigation fails
     * - is rejected when an error happens
     *
     * ### Usage
     *
     * ```
     * router.navigateByUrl("/team/33/user/11");
     * ```
     */
    navigateByUrl(url) {
        if (url instanceof UrlTree) {
            return this.scheduleNavigation(url, false);
        }
        else {
            const urlTree = this.urlSerializer.parse(url);
            return this.scheduleNavigation(urlTree, false);
        }
    }
    /**
     * Navigate based on the provided array of commands and a starting point.
     * If no starting route is provided, the navigation is absolute.
     *
     * Returns a promise that:
     * - is resolved with 'true' when navigation succeeds
     * - is resolved with 'false' when navigation fails
     * - is rejected when an error happens
     *
     * ### Usage
     *
     * ```
     * router.navigate(['team', 33, 'team', '11], {relativeTo: route});
     * ```
     */
    navigate(commands, extras = {}) {
        return this.scheduleNavigation(this.createUrlTree(commands, extras), false);
    }
    /**
     * Serializes a {@link UrlTree} into a string.
     */
    serializeUrl(url) { return this.urlSerializer.serialize(url); }
    /**
     * Parse a string into a {@link UrlTree}.
     */
    parseUrl(url) { return this.urlSerializer.parse(url); }
    scheduleNavigation(url, preventPushState) {
        const id = ++this.navigationId;
        this.routerEvents.next(new NavigationStart(id, this.serializeUrl(url)));
        return Promise.resolve().then((_) => this.runNavigate(url, preventPushState, id));
    }
    setUpLocationChangeListener() {
        this.locationSubscription = this.location.subscribe((change) => {
            const tree = this.urlSerializer.parse(change['url']);
            // we fire multiple events for a single URL change
            // we should navigate only once
            return this.currentUrlTree.toString() !== tree.toString() ?
                this.scheduleNavigation(tree, change['pop']) :
                null;
        });
    }
    runNavigate(url, preventPushState, id) {
        if (id !== this.navigationId) {
            this.location.go(this.urlSerializer.serialize(this.currentUrlTree));
            this.routerEvents.next(new NavigationCancel(id, this.serializeUrl(url)));
            return Promise.resolve(false);
        }
        return new Promise((resolvePromise, rejectPromise) => {
            let state;
            let navigationIsSuccessful;
            let preActivation;
            let appliedUrl;
            const storedState = this.currentRouterState;
            const storedUrl = this.currentUrlTree;
            applyRedirects(this.injector, this.configLoader, url, this.config)
                .mergeMap(u => {
                appliedUrl = u;
                return recognize(this.rootComponentType, this.config, appliedUrl, this.serializeUrl(appliedUrl));
            })
                .mergeMap((newRouterStateSnapshot) => {
                this.routerEvents.next(new RoutesRecognized(id, this.serializeUrl(url), this.serializeUrl(appliedUrl), newRouterStateSnapshot));
                return resolve(this.resolver, newRouterStateSnapshot);
            })
                .map((routerStateSnapshot) => {
                return createRouterState(routerStateSnapshot, this.currentRouterState);
            })
                .map((newState) => {
                state = newState;
                preActivation =
                    new PreActivation(state.snapshot, this.currentRouterState.snapshot, this.injector);
                preActivation.traverse(this.outletMap);
            })
                .mergeMap(_ => {
                return preActivation.checkGuards();
            })
                .mergeMap(shouldActivate => {
                if (shouldActivate) {
                    return preActivation.resolveData().map(() => shouldActivate);
                }
                else {
                    return Observable.of(shouldActivate);
                }
            })
                .forEach((shouldActivate) => {
                if (!shouldActivate || id !== this.navigationId) {
                    this.routerEvents.next(new NavigationCancel(id, this.serializeUrl(url)));
                    navigationIsSuccessful = false;
                    return;
                }
                this.currentUrlTree = appliedUrl;
                this.currentRouterState = state;
                new ActivateRoutes(state, storedState).activate(this.outletMap);
                if (!preventPushState) {
                    let path = this.urlSerializer.serialize(appliedUrl);
                    if (this.location.isCurrentPathEqualTo(path)) {
                        this.location.replaceState(path);
                    }
                    else {
                        this.location.go(path);
                    }
                }
                navigationIsSuccessful = true;
            })
                .then(() => {
                this.routerEvents.next(new NavigationEnd(id, this.serializeUrl(url), this.serializeUrl(appliedUrl)));
                resolvePromise(navigationIsSuccessful);
            }, e => {
                this.currentRouterState = storedState;
                this.currentUrlTree = storedUrl;
                this.routerEvents.next(new NavigationError(id, this.serializeUrl(url), e));
                rejectPromise(e);
            });
        });
    }
}
class CanActivate {
    constructor(path) {
        this.path = path;
    }
    get route() { return this.path[this.path.length - 1]; }
}
class CanDeactivate {
    constructor(component, route) {
        this.component = component;
        this.route = route;
    }
}
class PreActivation {
    constructor(future, curr, injector) {
        this.future = future;
        this.curr = curr;
        this.injector = injector;
        this.checks = [];
    }
    traverse(parentOutletMap) {
        const futureRoot = this.future._root;
        const currRoot = this.curr ? this.curr._root : null;
        this.traverseChildRoutes(futureRoot, currRoot, parentOutletMap, [futureRoot.value]);
    }
    checkGuards() {
        if (this.checks.length === 0)
            return Observable.of(true);
        return Observable.from(this.checks)
            .map(s => {
            if (s instanceof CanActivate) {
                return andObservables(Observable.from([this.runCanActivate(s.route), this.runCanActivateChild(s.path)]));
            }
            else if (s instanceof CanDeactivate) {
                // workaround https://github.com/Microsoft/TypeScript/issues/7271
                const s2 = s;
                return this.runCanDeactivate(s2.component, s2.route);
            }
            else {
                throw new Error('Cannot be reached');
            }
        })
            .mergeAll()
            .every(result => result === true);
    }
    resolveData() {
        if (this.checks.length === 0)
            return Observable.of(null);
        return Observable.from(this.checks)
            .mergeMap(s => {
            if (s instanceof CanActivate) {
                return this.runResolve(s.route);
            }
            else {
                return Observable.of(null);
            }
        })
            .reduce((_, __) => _);
    }
    traverseChildRoutes(futureNode, currNode, outletMap, futurePath) {
        const prevChildren = nodeChildrenAsMap(currNode);
        futureNode.children.forEach(c => {
            this.traverseRoutes(c, prevChildren[c.value.outlet], outletMap, futurePath.concat([c.value]));
            delete prevChildren[c.value.outlet];
        });
        forEach(prevChildren, (v, k) => this.deactivateOutletAndItChildren(v, outletMap._outlets[k]));
    }
    traverseRoutes(futureNode, currNode, parentOutletMap, futurePath) {
        const future = futureNode.value;
        const curr = currNode ? currNode.value : null;
        const outlet = parentOutletMap ? parentOutletMap._outlets[futureNode.value.outlet] : null;
        // reusing the node
        if (curr && future._routeConfig === curr._routeConfig) {
            if (!shallowEqual(future.params, curr.params)) {
                this.checks.push(new CanDeactivate(outlet.component, curr), new CanActivate(futurePath));
            }
            // If we have a component, we need to go through an outlet.
            if (future.component) {
                this.traverseChildRoutes(futureNode, currNode, outlet ? outlet.outletMap : null, futurePath);
            }
            else {
                this.traverseChildRoutes(futureNode, currNode, parentOutletMap, futurePath);
            }
        }
        else {
            if (curr) {
                // if we had a normal route, we need to deactivate only that outlet.
                if (curr.component) {
                    this.deactivateOutletAndItChildren(curr, outlet);
                }
                else {
                    this.deactivateOutletMap(parentOutletMap);
                }
            }
            this.checks.push(new CanActivate(futurePath));
            // If we have a component, we need to go through an outlet.
            if (future.component) {
                this.traverseChildRoutes(futureNode, null, outlet ? outlet.outletMap : null, futurePath);
            }
            else {
                this.traverseChildRoutes(futureNode, null, parentOutletMap, futurePath);
            }
        }
    }
    deactivateOutletAndItChildren(route, outlet) {
        if (outlet && outlet.isActivated) {
            this.deactivateOutletMap(outlet.outletMap);
            this.checks.push(new CanDeactivate(outlet.component, route));
        }
    }
    deactivateOutletMap(outletMap) {
        forEach(outletMap._outlets, (v) => {
            if (v.isActivated) {
                this.deactivateOutletAndItChildren(v.activatedRoute.snapshot, v);
            }
        });
    }
    runCanActivate(future) {
        const canActivate = future._routeConfig ? future._routeConfig.canActivate : null;
        if (!canActivate || canActivate.length === 0)
            return Observable.of(true);
        const obs = Observable.from(canActivate).map(c => {
            const guard = this.getToken(c, future, this.future);
            if (guard.canActivate) {
                return wrapIntoObservable(guard.canActivate(future, this.future));
            }
            else {
                return wrapIntoObservable(guard(future, this.future));
            }
        });
        return andObservables(obs);
    }
    runCanActivateChild(path) {
        const future = path[path.length - 1];
        const canActivateChildGuards = path.slice(0, path.length - 1)
            .reverse()
            .map(p => this.extractCanActivateChild(p))
            .filter(_ => _ !== null);
        return andObservables(Observable.from(canActivateChildGuards).map(d => {
            const obs = Observable.from(d.guards).map(c => {
                const guard = this.getToken(c, c.node, this.future);
                if (guard.canActivateChild) {
                    return wrapIntoObservable(guard.canActivateChild(future, this.future));
                }
                else {
                    return wrapIntoObservable(guard(future, this.future));
                }
            });
            return andObservables(obs);
        }));
    }
    extractCanActivateChild(p) {
        const canActivateChild = p._routeConfig ? p._routeConfig.canActivateChild : null;
        if (!canActivateChild || canActivateChild.length === 0)
            return null;
        return { node: p, guards: canActivateChild };
    }
    runCanDeactivate(component, curr) {
        const canDeactivate = curr && curr._routeConfig ? curr._routeConfig.canDeactivate : null;
        if (!canDeactivate || canDeactivate.length === 0)
            return Observable.of(true);
        return Observable.from(canDeactivate)
            .map(c => {
            const guard = this.getToken(c, curr, this.curr);
            if (guard.canDeactivate) {
                return wrapIntoObservable(guard.canDeactivate(component, curr, this.curr));
            }
            else {
                return wrapIntoObservable(guard(component, curr, this.curr));
            }
        })
            .mergeAll()
            .every(result => result === true);
    }
    runResolve(future) {
        const resolve = future._resolve;
        return this.resolveNode(resolve.current, future).map(resolvedData => {
            resolve.resolvedData = resolvedData;
            future.data = merge(future.data, resolve.flattenedResolvedData);
            return null;
        });
    }
    resolveNode(resolve, future) {
        return waitForMap(resolve, (k, v) => {
            const resolver = this.getToken(v, future, this.future);
            return resolver.resolve ? wrapIntoObservable(resolver.resolve(future, this.future)) :
                wrapIntoObservable(resolver(future, this.future));
        });
    }
    getToken(token, snapshot, state) {
        const config = closestLoadedConfig(state, snapshot);
        const injector = config ? config.injector : this.injector;
        return injector.get(token);
    }
}
function wrapIntoObservable(value) {
    if (value instanceof Observable) {
        return value;
    }
    else if (value instanceof Promise) {
        return Observable.fromPromise(value);
    }
    else {
        return Observable.of(value);
    }
}
class ActivateRoutes {
    constructor(futureState, currState) {
        this.futureState = futureState;
        this.currState = currState;
    }
    activate(parentOutletMap) {
        const futureRoot = this.futureState._root;
        const currRoot = this.currState ? this.currState._root : null;
        pushQueryParamsAndFragment(this.futureState);
        advanceActivatedRoute(this.futureState.root);
        this.activateChildRoutes(futureRoot, currRoot, parentOutletMap);
    }
    activateChildRoutes(futureNode, currNode, outletMap) {
        const prevChildren = nodeChildrenAsMap(currNode);
        futureNode.children.forEach(c => {
            this.activateRoutes(c, prevChildren[c.value.outlet], outletMap);
            delete prevChildren[c.value.outlet];
        });
        forEach(prevChildren, (v, k) => this.deactivateOutletAndItChildren(outletMap._outlets[k]));
    }
    activateRoutes(futureNode, currNode, parentOutletMap) {
        const future = futureNode.value;
        const curr = currNode ? currNode.value : null;
        // reusing the node
        if (future === curr) {
            // advance the route to push the parameters
            advanceActivatedRoute(future);
            // If we have a normal route, we need to go through an outlet.
            if (future.component) {
                const outlet = getOutlet(parentOutletMap, futureNode.value);
                this.activateChildRoutes(futureNode, currNode, outlet.outletMap);
            }
            else {
                this.activateChildRoutes(futureNode, currNode, parentOutletMap);
            }
        }
        else {
            if (curr) {
                // if we had a normal route, we need to deactivate only that outlet.
                if (curr.component) {
                    const outlet = getOutlet(parentOutletMap, futureNode.value);
                    this.deactivateOutletAndItChildren(outlet);
                }
                else {
                    this.deactivateOutletMap(parentOutletMap);
                }
            }
            // if we have a normal route, we need to advance the route
            // and place the component into the outlet. After that recurse.
            if (future.component) {
                advanceActivatedRoute(future);
                const outlet = getOutlet(parentOutletMap, futureNode.value);
                const outletMap = new RouterOutletMap();
                this.placeComponentIntoOutlet(outletMap, future, outlet);
                this.activateChildRoutes(futureNode, null, outletMap);
            }
            else {
                advanceActivatedRoute(future);
                this.activateChildRoutes(futureNode, null, parentOutletMap);
            }
        }
    }
    placeComponentIntoOutlet(outletMap, future, outlet) {
        const resolved = [{ provide: ActivatedRoute, useValue: future }, {
                provide: RouterOutletMap,
                useValue: outletMap
            }];
        const config = closestLoadedConfig(this.futureState.snapshot, future.snapshot);
        let loadedFactoryResolver = null;
        if (config) {
            const loadedResolver = config.factoryResolver;
            loadedFactoryResolver = loadedResolver;
            resolved.push({ provide: ComponentFactoryResolver, useValue: loadedResolver });
        }
        ;
        outlet.activate(future, loadedFactoryResolver, ReflectiveInjector.resolve(resolved), outletMap);
    }
    deactivateOutletAndItChildren(outlet) {
        if (outlet && outlet.isActivated) {
            this.deactivateOutletMap(outlet.outletMap);
            outlet.deactivate();
        }
    }
    deactivateOutletMap(outletMap) {
        forEach(outletMap._outlets, (v) => this.deactivateOutletAndItChildren(v));
    }
}
function closestLoadedConfig(state, snapshot) {
    const b = state.pathFromRoot(snapshot).filter(s => {
        const config = s._routeConfig;
        return config && config._loadedConfig && s !== snapshot;
    });
    return b.length > 0 ? b[b.length - 1]._routeConfig._loadedConfig : null;
}
function andObservables(observables) {
    return observables.mergeAll().every(result => result === true);
}
function pushQueryParamsAndFragment(state) {
    if (!shallowEqual(state.snapshot.queryParams, state.queryParams.value)) {
        state.queryParams.next(state.snapshot.queryParams);
    }
    if (state.snapshot.fragment !== state.fragment.value) {
        state.fragment.next(state.snapshot.fragment);
    }
}
function nodeChildrenAsMap(node) {
    return node ? node.children.reduce((m, c) => {
        m[c.value.outlet] = c;
        return m;
    }, {}) : {};
}
function getOutlet(outletMap, route) {
    let outlet = outletMap._outlets[route.outlet];
    if (!outlet) {
        const componentName = route.component.name;
        if (route.outlet === PRIMARY_OUTLET) {
            throw new Error(`Cannot find primary outlet to load '${componentName}'`);
        }
        else {
            throw new Error(`Cannot find the outlet ${route.outlet} to load '${componentName}'`);
        }
    }
    return outlet;
}
//# sourceMappingURL=router.js.map