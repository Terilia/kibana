/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import expect from '@kbn/expect';
import { ConnectorTypes, CustomFieldTypes } from '@kbn/cases-plugin/common/types/domain';
import { ConfigurationPatchRequest } from '@kbn/cases-plugin/common/types/api';
import { FtrProviderContext } from '../../../../common/ftr_provider_context';
import { ObjectRemover as ActionsRemover } from '../../../../../alerting_api_integration/common/lib';

import {
  removeServerGeneratedPropertiesFromSavedObject,
  getConfigurationOutput,
  deleteConfiguration,
  createConfiguration,
  updateConfiguration,
  getConfigurationRequest,
  getConfiguration,
} from '../../../../common/lib/api';
import {
  secOnly,
  obsOnlyRead,
  secOnlyRead,
  noKibanaPrivileges,
  globalRead,
  obsSecRead,
  superUser,
} from '../../../../common/lib/authentication/users';

// eslint-disable-next-line import/no-default-export
export default ({ getService }: FtrProviderContext): void => {
  const supertest = getService('supertest');
  const supertestWithoutAuth = getService('supertestWithoutAuth');
  const es = getService('es');

  describe('patch_configure', () => {
    const actionsRemover = new ActionsRemover(supertest);

    afterEach(async () => {
      await deleteConfiguration(es);
      await actionsRemover.removeAll();
    });

    it('should patch a configuration', async () => {
      const configuration = await createConfiguration(supertest);
      const newConfiguration = await updateConfiguration(supertest, configuration.id, {
        closure_type: 'close-by-pushing',
        version: configuration.version,
      });

      const data = removeServerGeneratedPropertiesFromSavedObject(newConfiguration);
      expect(data).to.eql({ ...getConfigurationOutput(true), closure_type: 'close-by-pushing' });
    });

    it('should patch a configuration with customFields', async () => {
      const customFields = [
        {
          key: 'text_field_1',
          label: '#1',
          type: CustomFieldTypes.TEXT,
          required: true,
        },
        {
          key: 'toggle_field',
          label: '#2',
          type: CustomFieldTypes.TOGGLE,
          required: false,
        },
        {
          key: 'text_field_2',
          label: '#3',
          type: CustomFieldTypes.TEXT,
          required: true,
          defaultValue: 'foobar',
        },
      ] as ConfigurationPatchRequest['customFields'];
      const configuration = await createConfiguration(supertest);
      const newConfiguration = await updateConfiguration(supertest, configuration.id, {
        version: configuration.version,
        customFields,
      });

      const data = removeServerGeneratedPropertiesFromSavedObject(newConfiguration);
      expect(data).to.eql({ ...getConfigurationOutput(true), customFields });
    });

    it('should update mapping when changing connector', async () => {
      const configuration = await createConfiguration(supertest);
      await updateConfiguration(supertest, configuration.id, {
        connector: {
          id: 'serviceNowITSM',
          name: 'ServiceNow ITSM',
          type: ConnectorTypes.serviceNowITSM,
          fields: null,
        },
        version: configuration.version,
      });
      const newConfiguration = await getConfiguration({ supertest });

      expect(configuration.mappings).to.eql([]);
      expect(newConfiguration[0].mappings).to.eql([
        {
          action_type: 'overwrite',
          source: 'title',
          target: 'short_description',
        },
        {
          action_type: 'overwrite',
          source: 'description',
          target: 'description',
        },
        {
          action_type: 'append',
          source: 'comments',
          target: 'work_notes',
        },
      ]);
    });

    describe('validation', () => {
      it('should not patch a configuration with unsupported connector type', async () => {
        const configuration = await createConfiguration(supertest);
        await updateConfiguration(
          supertest,
          configuration.id,
          // @ts-expect-error
          getConfigurationRequest({ type: '.unsupported' }),
          400
        );
      });

      it('should not patch a configuration with unsupported connector fields', async () => {
        const configuration = await createConfiguration(supertest);
        await updateConfiguration(
          supertest,
          configuration.id,
          // @ts-expect-error
          getConfigurationRequest({ type: '.jira', fields: { unsupported: 'value' } }),
          400
        );
      });

      it('should handle patch request when there is no configuration', async () => {
        const error = await updateConfiguration(
          supertest,
          'not-exist',
          { closure_type: 'close-by-pushing', version: 'no-version' },
          404
        );

        expect(error).to.eql({
          error: 'Not Found',
          message: 'Saved object [cases-configure/not-exist] not found',
          statusCode: 404,
        });
      });

      it('should handle patch request when versions are different', async () => {
        const configuration = await createConfiguration(supertest);
        const error = await updateConfiguration(
          supertest,
          configuration.id,
          { closure_type: 'close-by-pushing', version: 'no-version' },
          409
        );

        expect(error).to.eql({
          error: 'Conflict',
          message:
            'This configuration has been updated. Please refresh before saving additional updates.',
          statusCode: 409,
        });
      });

      it('should not allow to change the owner of the configuration', async () => {
        const configuration = await createConfiguration(supertest);
        await updateConfiguration(
          supertest,
          configuration.id,
          // @ts-expect-error
          { owner: 'observabilityFixture', version: configuration.version },
          400
        );
      });

      it('should not allow excess attributes', async () => {
        const configuration = await createConfiguration(supertest);
        await updateConfiguration(
          supertest,
          configuration.id,
          // @ts-expect-error
          { notExist: 'not-exist', version: configuration.version },
          400
        );
      });

      it('should not allow patching the type of a custom field', async () => {
        const configuration = await createConfiguration(
          supertest,
          getConfigurationRequest({
            overrides: {
              customFields: [
                {
                  key: 'wrong_type_key',
                  label: 'text',
                  type: CustomFieldTypes.TEXT,
                  required: false,
                },
              ],
            },
          })
        );

        await updateConfiguration(
          supertest,
          configuration.id,
          {
            version: configuration.version,
            customFields: [
              {
                key: 'wrong_type_key',
                label: '#1',
                type: CustomFieldTypes.TOGGLE,
                required: false,
              },
            ],
          },
          400
        );
      });

      it('should not patch a configuration with duplicated custom field keys', async () => {
        const configuration = await createConfiguration(supertest);
        await updateConfiguration(
          supertest,
          configuration.id,
          {
            version: configuration.version,
            customFields: [
              {
                key: 'triplicated_key',
                label: '#1',
                type: CustomFieldTypes.TEXT,
                required: false,
              },
              {
                key: 'triplicated_key',
                label: '#2',
                type: CustomFieldTypes.TOGGLE,
                required: false,
              },
              {
                key: 'triplicated_key',
                label: '#2',
                type: CustomFieldTypes.TOGGLE,
                required: false,
              },
            ],
          },
          400
        );
      });
    });

    describe('rbac', () => {
      it('User: security solution only - should update a configuration', async () => {
        const configuration = await createConfiguration(
          supertestWithoutAuth,
          getConfigurationRequest(),
          200,
          {
            user: secOnly,
            space: 'space1',
          }
        );

        const newConfiguration = await updateConfiguration(
          supertestWithoutAuth,
          configuration.id,
          {
            closure_type: 'close-by-pushing',
            version: configuration.version,
          },
          200,
          {
            user: secOnly,
            space: 'space1',
          }
        );

        expect(newConfiguration.owner).to.eql('securitySolutionFixture');
      });

      it('User: security solution only - should NOT update a configuration of different owner', async () => {
        const configuration = await createConfiguration(
          supertestWithoutAuth,
          { ...getConfigurationRequest(), owner: 'observabilityFixture' },
          200,
          {
            user: superUser,
            space: 'space1',
          }
        );

        await updateConfiguration(
          supertestWithoutAuth,
          configuration.id,
          {
            closure_type: 'close-by-pushing',
            version: configuration.version,
          },
          403,
          {
            user: secOnly,
            space: 'space1',
          }
        );
      });

      for (const user of [globalRead, secOnlyRead, obsOnlyRead, obsSecRead, noKibanaPrivileges]) {
        it(`User ${
          user.username
        } with role(s) ${user.roles.join()} - should NOT update a configuration`, async () => {
          const configuration = await createConfiguration(
            supertestWithoutAuth,
            getConfigurationRequest(),
            200,
            {
              user: superUser,
              space: 'space1',
            }
          );

          await updateConfiguration(
            supertestWithoutAuth,
            configuration.id,
            {
              closure_type: 'close-by-pushing',
              version: configuration.version,
            },
            403,
            {
              user,
              space: 'space1',
            }
          );
        });
      }

      it('should NOT update a configuration in a space with no permissions', async () => {
        const configuration = await createConfiguration(
          supertestWithoutAuth,
          { ...getConfigurationRequest(), owner: 'securitySolutionFixture' },
          200,
          {
            user: superUser,
            space: 'space2',
          }
        );

        await updateConfiguration(
          supertestWithoutAuth,
          configuration.id,
          {
            closure_type: 'close-by-pushing',
            version: configuration.version,
          },
          403,
          {
            user: secOnly,
            space: 'space2',
          }
        );
      });

      it('should NOT update a configuration created in space2 by making a request to space1', async () => {
        const configuration = await createConfiguration(
          supertestWithoutAuth,
          { ...getConfigurationRequest(), owner: 'securitySolutionFixture' },
          200,
          {
            user: superUser,
            space: 'space2',
          }
        );

        await updateConfiguration(
          supertestWithoutAuth,
          configuration.id,
          {
            closure_type: 'close-by-pushing',
            version: configuration.version,
          },
          404,
          {
            user: secOnly,
            space: 'space1',
          }
        );
      });
    });
  });
};
