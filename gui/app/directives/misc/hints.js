'use strict';
(function() {

    //This adds the <effect-options> element

    angular
        .module('firebotApp')
        .directive('hints', function() {
            return {
                restrict: 'A',
                scope: {
                    message: '=',
                    role: '<',
                    onActionSelected: "&"
                },
                controller: function(logger, $scope, $rootScope, $element, $compile, $document, $window, $uibPosition, $parse, $attrs, connectionService) {
                    let vm = this;

                    let shouldOpen = $scope.message.id !== "System";

                    let template = `
                        <div class="popover message-actions" role="{{vm.role}}">
                            <div class="name-wrapper">
                                <img class="user-avatar" ng-src="{{vm.message.user_avatar}}">
                                <span style="margin-left: 10px" class="user-name">{{vm.message.user_name}}</span>   
                            </div>
                            <div class="message-action" ng-repeat="action in vm.actions" ng-click="vm.actionClicked(action.name)">
                                <span class="action-icon"><i class="fal" ng-class="action.icon"></i></span>
                                <span class="action-name">{{action.name}}</span>                               
                            </div>                           
                        </div>
                    `;

                    let popoverScope = $rootScope.$new(true);
                    popoverScope.vm = vm;

                    let popover = {};

                    function loadPopover() {
                        popover = angular.element(template);
                        popover.css('display', 'none');
                        $compile(popover)(popoverScope);
                        return popover;
                    }
                    loadPopover();

                    function evaluateOuterScopeValue(scopeName, defaultValue, locals) {
                        if (angular.isDefined(scopeName)) {
                            return $parse(scopeName)($scope, locals);
                        }
                        return defaultValue;

                    }

                    vm.isVisible = false;
                    vm.message = $scope.message;
                    vm.role = $scope.role;

                    function getActions() {
                        let actions = [];
                        actions.push({
                            name: "Delete",
                            icon: "fa-trash-alt"
                        });

                        if (vm.message.user_name !== connectionService.accounts.streamer.username &&
                            vm.message.user_name !== connectionService.accounts.bot.username) {
                            actions.push({
                                name: "Whisper",
                                icon: "fa-envelope"
                            });

                            if (vm.message.user_roles.includes("Mod")) {
                                actions.push({
                                    name: "Unmod",
                                    icon: "fa-user-times"
                                });
                            } else {
                                actions.push({
                                    name: "Mod",
                                    icon: "fa-user-plus"
                                });
                            }

                            actions.push({
                                name: "Timeout",
                                icon: "fa-clock"
                            });

                            actions.push({
                                name: "Ban",
                                icon: "fa-ban"
                            });
                        }
                        return actions;
                    }

                    vm.actions = getActions();

                    function positionPopover() {
                        let position = $uibPosition.positionElements($element, popover, "auto top", true);
                        position.top += 'px';
                        position.left += 'px';
                        popover.css(position);
                    }

                    function showPopover() {
                        if (shouldOpen && !vm.isVisible && !evaluateOuterScopeValue($attrs.isDisabled, false)) {
                            loadPopover();
                            $document.find('body').append(popover);
                            popover.css({display: 'block'});
                            positionPopover();
                            vm.isVisible = true;
                            //assignOuterScopeValue('isOpen', true);
                        }
                    }

                    function hidePopover() {
                        if (vm.isVisible) {
                            popover.css({display: 'none'});
                            popover.remove();
                            vm.isVisible = false;
                            //assignOuterScopeValue('isOpen', false);
                        }
                    }

                    vm.actionClicked = (actionName) => {
                        $scope.onActionSelected({
                            actionName: actionName,
                            userName: $scope.message.user_name,
                            msgId: $scope.message.id
                        });
                        hidePopover();
                    };

                    function togglePopover() {
                        if (!vm.isVisible) {
                            showPopover();
                        } else {
                            hidePopover();
                        }
                    }

                    function documentClick(event) {
                        if (vm.isVisible && !popover[0].contains(event.target) && !$element[0].contains(event.target)) {
                            hidePopover();
                        }
                    }

                    vm.showPopover = showPopover;
                    vm.hidePopover = hidePopover;
                    vm.togglePopover = togglePopover;

                    $element.bind('click', togglePopover);

                    $document.bind('click', documentClick);

                    $scope.$on('$destroy', function() {
                        popover.remove();
                        $element.unbind('click', togglePopover);
                        $document.unbind('click', documentClick);
                        popoverScope.$destroy();
                    });
                }
            };
        });
}());