import React from 'react';
import {
	View,
	StyleSheet,
	Easing,
	UIManager,
	InteractionManager,
	Animated,
	findNodeHandle,
	Platform,
} from 'react-native';
import PropTypes from 'prop-types';

import TransitionItems from './TransitionItems';

export default class TransitionItemsView extends React.Component {
	constructor(props) {
		super(props);

		this._appearProgress = new Animated.Value(0);
		this._transitionProgress = new Animated.Value(0);
		this._transitionItems = new TransitionItems(
			newState => this._isMounted ? this.setState({...this.state, ...newState}) : 0,
			_ => this.state);

		this.state = { currentTransition: null };
		this._isMounted = false;
		this._overlay = null;
		this._fadeTransitionTime = 25;
	}

	_fadeTransitionTime
	_overlay
	_transitionItems
	_appearProgress
	_transitionProgress
	_layoutDoneResolve
	_isMounted
	_viewReference
	_appearTransitionPromise
	_appearTransitionPromiseResolve
	_viewNodeHandle
	_viewSize

	async onTransitionStart(props, prevProps, config) {

		// Set up promise to wait for layout cycles.
		const promise = this.waitForLayout();

		// Calling set state here ensures we re-render and generate all the
		// shared elements
		this.setState({...this.state, currentTransition: {props, prevProps}});
		await promise;

		// Get routes
		const fromRoute = props.scene.route.routeName;
		const toRoute = prevProps.scene.route.routeName;

		// Get items and measure those participating in this thingie
		const itemsToMeasure = this._transitionItems.getItemsToMeasure()
			.filter(e => e.route === fromRoute || e.route === toRoute);

		await this.measureItems(itemsToMeasure);

		this.resetSharedTransitions(fromRoute, toRoute);

		// Start shared elements
		this.beginSharedTransitions(fromRoute, toRoute);

		// Run swap animation
		let swapAnimationDone = null;
		const swapPromise = new Promise((resolve, reject) =>
			swapAnimationDone = resolve);

		// Begin swap animation on shared elements - they are faded in
		this._appearProgress.setValue(0);

		Animated.timing(this._appearProgress, {
			toValue: 1.0,
			duration: this._fadeTransitionTime,
			easing: Easing.linear,
			useNativeDriver : config.useNativeDriver,
		}).start(swapAnimationDone);

		await swapPromise;

		// Begin appear transitions for elements not in shared
		return this.beginAppearTransitions(props.index, prevProps.index, fromRoute, toRoute, config);
	}

	async onTransitionEnd(props, prevProps, config) {

		if(this._appearTransitionPromise)
			await this._appearTransitionPromise;

		const fromRoute = props.scene.route.routeName;
		const toRoute = prevProps.scene.route.routeName;

		let animationDoneFunc;
		const retVal = new Promise((resolve) => animationDoneFunc = resolve);

		// End swap animation on shared elements - they are faded in
		Animated.timing(this._appearProgress, {
			toValue: 0.0,
			duration: this._fadeTransitionTime,
			easing: Easing.linear,
			useNativeDriver : config.useNativeDriver
		}).start(async ()=> {
			this.setState({...this.state, currentTransition: null});
			if(this._appearTransitionPromise)
				await this._appearTransitionPromise;

			animationDoneFunc();
		});

		return retVal;
	}

	beginSharedTransitions(fromRoute, toRoute){
		const pairs = this._transitionItems.getMeasuredItemPairs(fromRoute, toRoute);
		const self = this;

		const sharedElements = pairs.map((pair, idx) => {
			const {fromItem, toItem} = pair;
			if(toItem.reactElement.getTransitionSpec() !== { metrics: toItem.metrics })
				toItem.reactElement.setTransitionSpec({ metrics: toItem.metrics });

			if(fromItem.reactElement.getTransitionSpec() !== { metrics: fromItem.metrics })
				fromItem.reactElement.setTransitionSpec({ metrics: fromItem.metrics });
		});
	}

	resetSharedTransitions(fromRoute, toRoute){
		this._transitionItems.resetSharedTransitions(fromRoute, toRoute);
	}

	async beginAppearTransitions(index, prevIndex, fromRoute, toRoute, config, needsMeasurement = false) {

		// Set up wait promise for appear transitions
		this._appearTransitionPromise = new Promise((resolve, reject) =>
			this._appearTransitionPromiseResolve = resolve);

		if(needsMeasurement){
			await this.waitForLayout();

			const itemsToMeasure = this._transitionItems.getItemsToMeasure()
				.filter(e => e.route === fromRoute || e.route === toRoute);

			await this.measureItems(itemsToMeasure);
		}

		const animations = [];
		let delayIndex = 0;

		const start = index > prevIndex ? 0 : 1;
		const end = index > prevIndex ? 1 : 0;
		this._transitionProgress.setValue(start);
		const startRoute = start > end ? fromRoute : toRoute;
		const endRoute = start < end ? fromRoute : toRoute;

		if(start < end){
			delayIndex = this.beginAppearTransitionsForRoute(startRoute, endRoute,
				animations, delayIndex, end, start, config, 1);

			delayIndex = this.beginAppearTransitionsForRoute(endRoute, startRoute,
				animations, delayIndex, start, end, config, -1);
		}
		else {
			delayIndex = this.beginAppearTransitionsForRoute(endRoute, startRoute,
				animations, delayIndex, start, end, config, -1);

			delayIndex = this.beginAppearTransitionsForRoute(startRoute, endRoute,
				animations, delayIndex + 1, end, start, config, 1);

		}

		const endAnimations = ()=> {
			if(this._appearTransitionPromiseResolve)
				this._appearTransitionPromiseResolve();

			this._appearTransitionPromiseResolve = null;
		}

		if(animations.length === 0){
			endAnimations();
			return;
		}

		if(needsMeasurement){
			if(Platform.OS == 'Android')
				InteractionManager.runAfterInteractions(() => Animated.parallel(animations).start(endAnimations));
			else {
				await new Promise((resolve, reject)=>
					setTimeout(resolve, this._getDelayFromIndexAndConfig(delayIndex, config.duration)));

				Animated.parallel(animations).start(endAnimations);
			}
		} else {
			Animated.parallel(animations).start(endAnimations);
		}

		// If moving back - wait for half of the delay before committing
		// to the final transition.
		if(index < prevIndex)
			return new Promise((resolve, reject)=>
				setTimeout(resolve, this._getDelayFromIndexAndConfig(delayIndex, config.duration)));
	}

	beginAppearTransitionsForRoute(fromRoute, toRoute, animations, delayIndex, start, end, config, direction = 1){
		if(fromRoute === null)
			return delayIndex;

		const appearElements = this._transitionItems.getAppearElements(fromRoute, toRoute);
		if(appearElements.length === 0)
			return delayIndex;

		let index = delayIndex;
		transitionSpec = {...config};
		const { timing } = transitionSpec;
		delete transitionSpec.timing;

		const transitionConfiguration = { start, end, timing, direction,
			config: transitionSpec,
		};

		for(let i=0; i<appearElements.length; i++){
			const item = appearElements[i];
			item.reactElement.setTransitionSpec({
				...transitionConfiguration,
				delay: item.nodelay ? 0 : this._getDelayFromIndexAndConfig(index, config.duration),
				metrics: item.metrics});

			const animation = item.reactElement.getAnimation();

			if(!item.nodelay)
				index++;

			animations.push(animation);
		}

		return index;
	}

	_getDelayFromIndexAndConfig(index, duration){
		return index * (duration * 0.1);
	}

	render() {
		const overlay = this.renderOverlay();
		return(
			<Animated.View
				style={[this.props.style]}
				onLayout={this.onLayout.bind(this)}
				ref={ref => this._viewReference = ref}
			>
				{this.props.children}
				{overlay}
			</Animated.View>

		);
	}
	renderOverlay() {
		if(!this.state.currentTransition)
			return;

		const { props, prevProps } = this.state.currentTransition;
		const fromRoute = prevProps ? prevProps.scene.route.routeName : 'unknownRoute';
		const toRoute = props.scene.route.routeName;

		const pairs = this._transitionItems.getMeasuredItemPairs(fromRoute, toRoute);
		const self = this;

		const sharedElements = pairs.map((pair, idx) => {
			const {fromItem, toItem} = pair;

			const animatedStyle = this._getAnimatedStyle(props.progress, fromItem, toItem);

			// Buttons needs to be wrapped in a view to work properly.
			let element = fromItem.getReactElement();
			if(element.type.name === 'Button')
				element = (<View>{element}</View>);

			const AnimatedComp = Animated.createAnimatedComponent(element.type);

			const sharedElement = React.createElement(AnimatedComp,
				{ ...element.props, style: [element.props.style, animatedStyle], key: idx },
				element.props.children);

			return sharedElement;
		});

		return (
			<Animated.View
				style={[styles.overlay]}
				ref={ref => this._overlay}
				onLayout={this.onLayout.bind(this)}
			>
				{sharedElements}
			</Animated.View>
		);
	}
	async onLayout(event) {

		if(!this._viewNodeHandle)
			this._viewNodeHandle = findNodeHandle(this._viewReference);

		let b = null;
		const p = new Promise((resolve, reject) => b = resolve);
		UIManager.measureInWindow(this._viewNodeHandle, (x, y, width, height)=>{
			this._viewSize = {x, y, width, height}; b();
		})
		await p;

		this._layoutResolved();
	}
	async measureItems(itemsToMeasure) {
		const toUpdate = [];

		for(let i=0; i<itemsToMeasure.length; i++){
			const item = itemsToMeasure[i];
			const metrics = await item.measure(this._viewSize);
			toUpdate.push({ name: item.name, route: item.route, metrics });
		};

		if (toUpdate.length > 0) {
			this._transitionItems.updateMetrics(toUpdate);
		}
	}
	_layoutResolved() {
		if(this._layoutDoneResolve) {
			this._layoutDoneResolve();
			this._layoutDoneResolve = null;
		}
	}
	_getAnimatedStyle(progress, itemFrom, itemTo) {
		const toVsFromScaleX = itemTo.scaleRelativeTo(itemFrom).x;
		const toVsFromScaleY = itemTo.scaleRelativeTo(itemFrom).y;

		const scaleX = progress.interpolate({
			inputRange: [0, 1],
			outputRange: [1, toVsFromScaleX],
		});

		const scaleY = progress.interpolate({
			inputRange: [0, 1],
			outputRange: [1, toVsFromScaleY],
		});

		const translateX = progress.interpolate({
			inputRange: [0, 1],
			outputRange: [itemFrom.metrics.x, itemTo.metrics.x +
				itemFrom.metrics.width/2 * (toVsFromScaleX-1)],
		});

		const translateY = progress.interpolate({
			inputRange: [0, 1],
			outputRange: [itemFrom.metrics.y, itemTo.metrics.y +
				itemFrom.metrics.height/2 * (toVsFromScaleY-1)],
		});

		return [styles.sharedElement, {
			width: itemFrom.metrics.width,
			height: itemFrom.metrics.height,
			transform: [{ translateX }, { translateY }, { scaleX }, { scaleY }]
		}];
	}

	waitForLayout(){
		return new Promise((resolve, reject) => this._layoutDoneResolve = resolve);
	}

	static childContextTypes = {
		register: PropTypes.func,
		unregister: PropTypes.func,
		appearProgress: PropTypes.object,
		transitionProgress: PropTypes.object,
	}
	shouldComponentUpdate(nextProps, nextState) {
		return this.state != nextState;
	}
	componentDidMount() {
		this._isMounted = true;
	}
	componentWillUnmount() {
		this._isMounted = false;
	}
	getChildContext() {
		return {
			register: (item) => this._transitionItems.add(item),
			unregister: (name, route) => this._transitionItems.remove(name, route),
			appearProgress: this._appearProgress,
			transitionProgress: this._transitionProgress,
		};
	}
}

const styles = StyleSheet.create({
	overlay: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
	},
	sharedElement: {
		position: 'absolute',
		// borderColor: '#34CE34',
		// borderWidth: 2,
		margin: 0,
		left: 0,
		top: 0,
	}
});
