/* eslint camelcase: 0 */
/* eslint arrow-body-style: 0 */
function EditCredentialsController (
    models,
    $state,
    $scope,
    strings,
    componentsStrings,
    ConfigService,
    ngToast,
    Wait,
    $filter,
    CredentialType,
    GetBasePath,
    Rest,
) {
    const vm = this || {};
    const {
        me,
        credential,
        credentialType,
        organization,
        isOrgCredAdmin,
    } = models;

    const omit = ['user', 'team', 'inputs'];
    const isEditable = credential.isEditable();
    const isExternal = credentialType.get('kind') === 'external';

    vm.mode = 'edit';
    vm.strings = strings;
    vm.panelTitle = credential.get('name');

    vm.tab = {
        details: {
            _active: true,
            _go: 'credentials.edit',
            _params: { credential_id: credential.get('id') }
        },
        permissions: {
            _go: 'credentials.edit.permissions',
            _params: { credential_id: credential.get('id') }
        }
    };

    $scope.$watch('$state.current.name', (value) => {
        if (/credentials.edit($|\.organization$|\.credentialType$)/.test(value)) {
            vm.tab.details._active = true;
            vm.tab.permissions._active = false;
        } else {
            vm.tab.permissions._active = true;
            vm.tab.details._active = false;
        }
    });

    $scope.$watch('organization', () => {
        if ($scope.organization) {
            vm.form.organization._idFromModal = $scope.organization;
        }
    });

    $scope.$watch('credential_type', () => {
        if ($scope.credential_type) {
            vm.form.credential_type._idFromModal = $scope.credential_type;
        }
    });

    // Only exists for permissions compatibility
    $scope.credential_obj = credential.get();

    if (isEditable) {
        vm.form = credential.createFormSchema('put', { omit });
    } else {
        vm.form = credential.createFormSchema({ omit });
        vm.form.disabled = !isEditable;
    }

    const isOrgAdmin = _.some(me.get('related.admin_of_organizations.results'), (org) => org.id === organization.get('id'));
    const isSuperuser = me.get('is_superuser');
    const isCurrentAuthor = Boolean(credential.get('summary_fields.created_by.id') === me.get('id'));
    vm.form.organization._disabled = true;

    if (isSuperuser || isOrgAdmin || isOrgCredAdmin || (credential.get('organization') === null && isCurrentAuthor)) {
        vm.form.organization._disabled = false;
    }

    vm.form.organization._resource = 'organization';
    vm.form.organization._model = organization;
    vm.form.organization._route = 'credentials.edit.organization';
    vm.form.organization._value = credential.get('summary_fields.organization.id');
    vm.form.organization._displayValue = credential.get('summary_fields.organization.name');
    vm.form.organization._placeholder = strings.get('inputs.ORGANIZATION_PLACEHOLDER');

    vm.form.credential_type._resource = 'credential_type';
    vm.form.credential_type._model = credentialType;
    vm.form.credential_type._route = 'credentials.edit.credentialType';
    vm.form.credential_type._value = credentialType.get('id');
    vm.form.credential_type._displayValue = credentialType.get('name');
    vm.form.credential_type._placeholder = strings.get('inputs.CREDENTIAL_TYPE_PLACEHOLDER');
    vm.isTestable = (isEditable && credentialType.get('kind') === 'external');

    const gceFileInputSchema = {
        id: 'gce_service_account_key',
        type: 'file',
        label: strings.get('inputs.GCE_FILE_INPUT_LABEL'),
        help_text: strings.get('inputs.GCE_FILE_INPUT_HELP_TEXT'),
    };

    let gceFileInputPreEditValues;

    vm.form.inputs = {
        _get ({ getSubmitData }) {
            const apiConfig = ConfigService.get();

            credentialType.mergeInputProperties();
            const fields = credential.assignInputGroupValues(apiConfig, credentialType);

            if (credentialType.get('name') === 'Google Compute Engine') {
                fields.splice(2, 0, gceFileInputSchema);
                $scope.$watch(`vm.form.${gceFileInputSchema.id}._value`, vm.gceOnFileInputChanged);
                $scope.$watch('vm.form.ssh_key_data._isBeingReplaced', vm.gceOnReplaceKeyChanged);
            }

            vm.inputSources.initialItems = credential.get('related.input_sources.results');
            vm.inputSources.items = [];
            if (credential.get('credential_type') === credentialType.get('id')) {
                vm.inputSources.items = credential.get('related.input_sources.results');
            }
            vm.isTestable = (isEditable && credentialType.get('kind') === 'external');
            vm.getSubmitData = getSubmitData;

            return fields;
        },
        _onRemoveTag ({ id }) {
            vm.onInputSourceClear(id);
        },
        _onInputLookup ({ id }) {
            vm.onInputSourceOpen(id);
        },
        _source: vm.form.credential_type,
        _reference: 'vm.form.inputs',
        _key: 'inputs',
        border: true,
        title: true,
    };

    vm.externalTest = {
        form: {
            inputs: {
                _get: () => vm.externalTest.metadataInputs,
                _reference: 'vm.form.inputs',
                _key: 'inputs',
                _source: { _value: {} },
            },
        },
        metadataInputs: null,
    };
    vm.inputSources = {
        tabs: {
            credential: {
                _active: true,
                _disabled: false,
            },
            metadata: {
                _active: false,
                _disabled: false,
            }
        },
        form: {
            inputs: {
                _get: () => vm.inputSources.metadataInputs,
                _reference: 'vm.form.inputs',
                _key: 'inputs',
                _source: { _value: {} },
            },
        },
        field: null,
        credentialTypeId: null,
        credentialTypeName: null,
        credentialId: null,
        credentialName: null,
        metadataInputs: null,
        initialItems: credential.get('related.input_sources.results'),
        items: credential.get('related.input_sources.results'),
    };

    vm.onInputSourceClear = (field) => {
        vm.form[field].tagMode = true;
        vm.form[field].asTag = false;
        vm.form[field]._value = '';
        vm.inputSources.items = vm.inputSources.items
            .filter(({ input_field_name }) => input_field_name !== field);
    };

    function setInputSourceTab (name) {
        const metaIsActive = name === 'metadata';
        vm.inputSources.tabs.credential._active = !metaIsActive;
        vm.inputSources.tabs.credential._disabled = false;
        vm.inputSources.tabs.metadata._active = metaIsActive;
        vm.inputSources.tabs.metadata._disabled = false;
    }

    function unsetInputSourceTabs () {
        vm.inputSources.tabs.credential._active = false;
        vm.inputSources.tabs.credential._disabled = false;
        vm.inputSources.tabs.metadata._active = false;
        vm.inputSources.tabs.metadata._disabled = false;
    }

    vm.onInputSourceOpen = (field) => {
        // We get here when the input source lookup modal for a field is opened. If source
        // credential and metadata values for this field already exist in the initial API data
        // or from it being set during a prior visit to the lookup, we initialize the lookup with
        // these values here before opening it.
        const sourceItem = vm.inputSources.items
            .find(({ input_field_name }) => input_field_name === field);
        if (sourceItem) {
            const { source_credential, summary_fields } = sourceItem;
            const { source_credential: { credential_type_id, name } } = summary_fields;
            vm.inputSources.credentialId = source_credential;
            vm.inputSources.credentialName = name;
            vm.inputSources.credentialTypeId = credential_type_id;
            vm.inputSources._value = credential_type_id;
        }
        setInputSourceTab('credential');
        vm.inputSources.field = field;
    };

    vm.onInputSourceClose = () => {
        // We get here if the lookup was closed or canceled so we clear the state for the lookup
        // and metadata form without storing any changes.
        vm.inputSources.field = null;
        vm.inputSources.credentialId = null;
        vm.inputSources.credentialName = null;
        vm.inputSources.metadataInputs = null;
        unsetInputSourceTabs();
    };

    /**
     * Extract the current set of input values from the metadata form and reshape them to a
     * metadata object that can be sent to the api later or reloaded when re-opening the form.
     */
    function getMetadataFormSubmitData ({ inputs }) {
        const metadata = Object.assign({}, ...inputs._group
            .filter(({ _value }) => _value !== undefined)
            .map(({ id, _value }) => ({ [id]: _value })));
        return metadata;
    }

    vm.onInputSourceNext = () => {
        const { field, credentialId, credentialTypeId } = vm.inputSources;
        Wait('start');
        new CredentialType('get', credentialTypeId)
            .then(model => {
                model.mergeInputProperties('metadata');
                vm.inputSources.metadataInputs = model.get('inputs.metadata');
                vm.inputSources.credentialTypeName = model.get('name');
                // Pre-populate the input values for the metadata form if state for this specific
                // field_name->source_credential link already exists. This occurs one of two ways:
                //
                // 1. This field->source_credential link already exists in the API and so we're
                //    reflecting the current state as it exists on the backend.
                // 2. The metadata form for this specific field->source_credential combination was
                //    set during a prior visit to this lookup and so we're reflecting the most
                //    recent set of (unsaved) metadata values provided by the user for this field.
                //
                // Note: Prior state for a given credential input field is only set for one source
                // credential at a time. Linking a field to a source credential will remove all
                // other prior input state for that field.
                const [metavals] = vm.inputSources.items
                    .filter(({ input_field_name }) => input_field_name === field)
                    .filter(({ source_credential }) => source_credential === credentialId)
                    .map(({ metadata }) => metadata);
                Object.keys(metavals || {}).forEach(key => {
                    const obj = vm.inputSources.metadataInputs.find(o => o.id === key);
                    if (obj) obj._value = metavals[key];
                });
                setInputSourceTab('metadata');
            })
            .finally(() => Wait('stop'));
    };

    vm.onInputSourceSelect = () => {
        const { field, credentialId, credentialName, credentialTypeId } = vm.inputSources;
        const metadata = getMetadataFormSubmitData(vm.inputSources.form);
        // Remove any input source objects already stored for this field then store the metadata
        // and currently selected source credential as a valid credential input source object that
        // can be sent to the api later or reloaded into the form if it is reopened.
        vm.inputSources.items = vm.inputSources.items
            .filter(({ input_field_name }) => input_field_name !== field)
            .concat([{
                metadata,
                input_field_name: field,
                source_credential: credentialId,
                target_credential: credential.get('id'),
                summary_fields: {
                    source_credential: {
                        name: credentialName,
                        credential_type_id: credentialTypeId
                    }
                },
            }]);
        // Now that we've extracted and stored the selected source credential and metadata values
        // for this field, we clear the state for the source credential lookup and metadata form.
        vm.inputSources.field = null;
        vm.inputSources.metadataInputs = null;
        unsetInputSourceTabs();
        // We've linked this field to a credential, so display value as a credential tag
        vm.form[field]._value = credentialName;
        vm.form[field].asTag = true;
    };

    vm.onInputSourceTabSelect = (name) => {
        if (name === 'metadata') {
            // Clicking on the metadata tab should have identical behavior to clicking the 'next'
            // button, so we pass-through to the same handler here.
            vm.onInputSourceNext();
        } else {
            setInputSourceTab('credential');
        }
    };

    vm.onInputSourceRowClick = ({ id, credential_type, name }) => {
        vm.inputSources.credentialId = id;
        vm.inputSources.credentialName = name;
        vm.inputSources.credentialTypeId = credential_type;
        vm.inputSources._value = credential_type;
    };

    vm.onInputSourceTest = () => {
        // We get here if the test button on the metadata form for the field of a non-external
        // credential was used. All input values for the external credential are already stored
        // on the backend, so we are only testing how it works with a set of metadata before
        // linking it.
        const metadata = getMetadataFormSubmitData(vm.inputSources.form);
        const name = $filter('sanitize')(vm.inputSources.credentialTypeName);
        const endpoint = `${vm.inputSources.credentialId}/test/`;
        return runTest({ name, model: credential, endpoint, data: { metadata } });
    };

    function onExternalTestOpen () {
        // We get here if test button on the top-level form for an external credential type was
        // used. We load the metadata schema for this particular external credential type and
        // use it to generate and open a form for submitting test values.
        credentialType.mergeInputProperties('metadata');
        vm.externalTest.metadataInputs = credentialType.get('inputs.metadata');
    }
    vm.form.secondary = onExternalTestOpen;

    vm.onExternalTestClose = () => {
        // We get here if the metadata test form for an external credential type was canceled or
        // closed so we clear the form state and close without submitting any data to the test api,
        vm.externalTest.metadataInputs = null;
    };

    vm.onExternalTest = () => {
        const name = $filter('sanitize')(credentialType.get('name'));
        const { inputs } = vm.getSubmitData();
        const metadata = getMetadataFormSubmitData(vm.externalTest.form);
        // We get here if the test button on the top-level form for an external credential type was
        // used. We need to see if the currently selected credential type is the one loaded from
        // the api when we initialized the view or if its type was changed on the form and hasn't
        // been saved. If the credential type hasn't been changed, it means some of the input
        // values for the credential may be stored in the backend and not in the form, so we need
        // to use the test endpoint for the credential. If the credential type has been changed,
        // the user must provide a complete set of input values for the credential to save their
        // changes, so we use the generic test endpoint for the credental type as if we were
        // testing a completely new and unsaved credential.
        let model;
        if (credential.get('credential_type') !== credentialType.get('id')) {
            model = credentialType;
        } else {
            model = credential;
        }

        const endpoint = `${model.get('id')}/test/`;
        return runTest({ name, model, endpoint, data: { inputs, metadata } });
    };

    vm.filterInputSourceCredentialResults = (data) => {
        // If an external credential is changed to have a non-external `credential_type` while
        // editing, we avoid showing a self-reference in the list of selectable external
        // credentials for input fields by filtering it out here.
        if (isExternal) {
            data.results = data.results.filter(({ id }) => id !== credential.get('id'));
        }
        return data;
    };

    function runTest ({ name, model, endpoint, data: { inputs, metadata } }) {
        return model.http.post({ url: endpoint, data: { inputs, metadata }, replace: false })
            .then(() => {
                const icon = 'fa-check-circle';
                const msg = strings.get('edit.TEST_PASSED');
                const content = buildTestNotificationContent({ name, icon, msg });
                ngToast.success({
                    content,
                    dismissButton: false,
                    dismissOnTimeout: true
                });
            })
            .catch(({ data }) => {
                const icon = 'fa-exclamation-triangle';
                const msg = data.inputs || strings.get('edit.TEST_FAILED');
                const content = buildTestNotificationContent({ name, icon, msg });
                ngToast.danger({
                    content,
                    dismissButton: false,
                    dismissOnTimeout: true
                });
            });
    }

    function buildTestNotificationContent ({ name, msg, icon }) {
        const sanitize = $filter('sanitize');
        const content = `<div class="Toast-wrapper">
            <div class="Toast-icon">
                <i class="fa ${icon} Toast-successIcon"></i>
            </div>
            <div>
                <b>${sanitize(name)}:</b> ${sanitize(msg)}
            </div>
        </div>`;
        return content;
    }

    function deleteInputSource ({ id }) {
        Rest.setUrl(`${GetBasePath('credential_input_sources')}${id}/`);
        return Rest.destroy();
    }

    function createInputSource (data) {
        Rest.setUrl(GetBasePath('credential_input_sources'));
        return Rest.post(data);
    }

    /**
     * If a credential's `credential_type` is changed while editing, the inputs associated with
     * the old type need to be cleared before saving the inputs associated with the new type.
     * Otherwise inputs are merged together making the request invalid.
     */
    vm.form.save = data => {
        data.user = me.get('id');
        credential.unset('inputs');

        if (_.get(data.inputs, gceFileInputSchema.id)) {
            delete data.inputs[gceFileInputSchema.id];
        }

        const initialLinkedFieldNames = vm.inputSources.initialItems
            .map(({ input_field_name }) => input_field_name);
        const updatedLinkedFieldNames = vm.inputSources.items
            .map(({ input_field_name }) => input_field_name);

        const fieldsToDisassociate = [...initialLinkedFieldNames]
            .filter(name => !updatedLinkedFieldNames.includes(name));
        const fieldsToAssociate = [...updatedLinkedFieldNames]
            .filter(name => !initialLinkedFieldNames.includes(name));

        const sourcesToDisassociate = [...fieldsToDisassociate]
            .map(name => vm.inputSources.initialItems
                .find(({ input_field_name }) => input_field_name === name));
        const sourcesToAssociate = [...fieldsToAssociate]
            .map(name => vm.inputSources.items
                .find(({ input_field_name }) => input_field_name === name));

        // remove inputs with empty string values
        let filteredInputs = _.omit(data.inputs, (value) => value === '');
        // remove inputs that are to be linked to an external credential
        filteredInputs = _.omit(filteredInputs, updatedLinkedFieldNames);
        data.inputs = filteredInputs;

        return Promise.all(sourcesToDisassociate.map(deleteInputSource))
            .then(() => credential.request('put', { data }))
            .then(() => Promise.all(sourcesToAssociate.map(createInputSource)));
    };

    vm.form.onSaveSuccess = () => {
        $state.go('credentials.edit', { credential_id: credential.get('id') }, { reload: true });
    };

    vm.gceOnReplaceKeyChanged = value => {
        vm.form[gceFileInputSchema.id]._disabled = !value;
    };

    vm.gceOnFileInputChanged = (value, oldValue) => {
        if (value === oldValue) return;

        const gceFileIsLoaded = !!value;
        const gceFileInputState = vm.form[gceFileInputSchema.id];
        const { obj, error } = vm.gceParseFileInput(value);

        gceFileInputState._isValid = !error;
        gceFileInputState._message = error ? componentsStrings.get('message.INVALID_INPUT') : '';

        vm.form.project._disabled = gceFileIsLoaded;
        vm.form.username._disabled = gceFileIsLoaded;
        vm.form.ssh_key_data._disabled = gceFileIsLoaded;
        vm.form.ssh_key_data._displayHint = !vm.form.ssh_key_data._disabled;

        if (gceFileIsLoaded) {
            gceFileInputPreEditValues = Object.assign({}, {
                project: vm.form.project._value,
                ssh_key_data: vm.form.ssh_key_data._value,
                username: vm.form.username._value
            });
            vm.form.project._value = _.get(obj, 'project_id', '');
            vm.form.ssh_key_data._value = _.get(obj, 'private_key', '');
            vm.form.username._value = _.get(obj, 'client_email', '');
        } else {
            vm.form.project._value = gceFileInputPreEditValues.project;
            vm.form.ssh_key_data._value = gceFileInputPreEditValues.ssh_key_data;
            vm.form.username._value = gceFileInputPreEditValues.username;
        }
    };

    vm.gceParseFileInput = value => {
        let obj;
        let error;

        try {
            obj = angular.fromJson(value);
        } catch (err) {
            error = err;
        }

        return { obj, error };
    };
}

EditCredentialsController.$inject = [
    'resolvedModels',
    '$state',
    '$scope',
    'CredentialsStrings',
    'ComponentsStrings',
    'ConfigService',
    'ngToast',
    'Wait',
    '$filter',
    'CredentialTypeModel',
    'GetBasePath',
    'Rest',
];

export default EditCredentialsController;
