/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  EuiButtonEmpty,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiSpacer,
} from '@elastic/eui';
import React, { Fragment } from 'react';
import { flyoutCancelText } from '../../../common/translations';
import { useDatasetQualityFlyout } from '../../hooks';
import { DatasetSummary, DatasetSummaryLoading } from './dataset_summary';
import { Header } from './header';
import { IntegrationSummary } from './integration_summary';
import { FlyoutProps } from './types';

// Allow for lazy loading
// eslint-disable-next-line import/no-default-export
export default function Flyout({ dataset, closeFlyout }: FlyoutProps) {
  const { dataStreamStat, dataStreamDetails, dataStreamDetailsLoading, fieldFormats } =
    useDatasetQualityFlyout();

  return (
    <EuiFlyout onClose={closeFlyout} ownFocus={false} data-component-name={'datasetQualityFlyout'}>
      <>
        <Header dataStreamStat={dataset} />
        <EuiFlyoutBody>
          {dataStreamDetailsLoading ? (
            <DatasetSummaryLoading />
          ) : dataStreamStat ? (
            <Fragment>
              <DatasetSummary dataStreamDetails={dataStreamDetails} fieldFormats={fieldFormats} />
              <EuiSpacer />
              {dataStreamStat.integration && (
                <IntegrationSummary integration={dataStreamStat.integration} />
              )}
            </Fragment>
          ) : null}
        </EuiFlyoutBody>

        <EuiFlyoutFooter>
          <EuiFlexGroup justifyContent="spaceBetween">
            <EuiFlexItem grow={false}>
              <EuiButtonEmpty iconType="cross" onClick={closeFlyout} flush="left">
                {flyoutCancelText}
              </EuiButtonEmpty>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlyoutFooter>
      </>
    </EuiFlyout>
  );
}
