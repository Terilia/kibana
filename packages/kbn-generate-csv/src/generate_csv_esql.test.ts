/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import * as Rx from 'rxjs';
import type { Writable } from 'stream';

import { errors as esErrors } from '@elastic/elasticsearch';
import type { IScopedClusterClient, IUiSettingsClient, Logger } from '@kbn/core/server';
import {
  elasticsearchServiceMock,
  loggingSystemMock,
  savedObjectsClientMock,
  uiSettingsServiceMock,
} from '@kbn/core/server/mocks';
import { IKibanaSearchResponse } from '@kbn/data-plugin/common';
import { IScopedSearchClient } from '@kbn/data-plugin/server';
import { dataPluginMock } from '@kbn/data-plugin/server/mocks';
import type { ESQLSearchReponse } from '@kbn/es-types';
import { CancellationToken } from '@kbn/reporting-common';
import type { ReportingConfigType } from '@kbn/reporting-server';
import {
  UI_SETTINGS_CSV_QUOTE_VALUES,
  UI_SETTINGS_CSV_SEPARATOR,
  UI_SETTINGS_DATEFORMAT_TZ,
} from '../constants';
import { CsvESQLGenerator, JobParamsCsvESQL } from './generate_csv_esql';

const createMockJob = (
  params: Partial<JobParamsCsvESQL> = { query: { esql: '' } }
): JobParamsCsvESQL => ({
  ...params,
  query: { esql: '' },
});

describe('CsvESQLGenerator', () => {
  let mockEsClient: IScopedClusterClient;
  let mockDataClient: IScopedSearchClient;
  let mockConfig: ReportingConfigType['csv'];
  let mockLogger: jest.Mocked<Logger>;
  let uiSettingsClient: IUiSettingsClient;
  let stream: jest.Mocked<Writable>;
  let content: string;

  const getMockRawResponse = (
    esqlResponse: ESQLSearchReponse = {
      columns: [],
      values: [],
    }
  ): ESQLSearchReponse => esqlResponse;

  const mockDataClientSearchDefault = jest.fn().mockImplementation(
    (): Rx.Observable<IKibanaSearchResponse<ESQLSearchReponse>> =>
      Rx.of({
        rawResponse: getMockRawResponse(),
      })
  );

  const mockSearchResponse = (response: ESQLSearchReponse) => {
    mockDataClient.search = jest.fn().mockImplementation(() =>
      Rx.of({
        rawResponse: getMockRawResponse(response),
      })
    );
  };

  beforeEach(async () => {
    content = '';
    stream = { write: jest.fn((chunk) => (content += chunk)) } as unknown as typeof stream;
    mockEsClient = elasticsearchServiceMock.createScopedClusterClient();
    mockDataClient = dataPluginMock.createStartContract().search.asScoped({} as any);
    mockDataClient.search = mockDataClientSearchDefault;
    uiSettingsClient = uiSettingsServiceMock
      .createStartContract()
      .asScopedToClient(savedObjectsClientMock.create());
    uiSettingsClient.get = jest.fn().mockImplementation((key): any => {
      switch (key) {
        case UI_SETTINGS_CSV_QUOTE_VALUES:
          return true;
        case UI_SETTINGS_CSV_SEPARATOR:
          return ',';
        case UI_SETTINGS_DATEFORMAT_TZ:
          return 'Browser';
      }
    });

    mockConfig = {
      checkForFormulas: true,
      escapeFormulaValues: true,
      maxSizeBytes: 180000,
      useByteOrderMarkEncoding: false,
      scroll: { size: 500, duration: '30s', strategy: 'pit' },
      enablePanelActionDownload: true,
      maxConcurrentShardRequests: 5,
    };

    mockLogger = loggingSystemMock.createLogger();
  });

  it('formats an empty search result to CSV content', async () => {
    const generateCsv = new CsvESQLGenerator(
      createMockJob({ columns: ['date', 'ip', 'message'] }),
      mockConfig,
      {
        es: mockEsClient,
        data: mockDataClient,
        uiSettings: uiSettingsClient,
      },
      new CancellationToken(),
      mockLogger,
      stream
    );
    const csvResult = await generateCsv.generateData();
    expect(content).toMatchInlineSnapshot(`
      "
      "
    `);
    expect(csvResult.csv_contains_formulas).toBe(false);
  });

  it('formats a search result to CSV content', async () => {
    mockSearchResponse({
      columns: [
        { name: 'date', type: 'date' },
        { name: 'ip', type: 'ip' },
        { name: 'message', type: 'string' },
        { name: 'geo.coordinates', type: 'geo_point' },
      ],
      values: [['2020-12-31T00:14:28.000Z', '110.135.176.89', 'This is a great message!', null]],
    });

    const generateCsv = new CsvESQLGenerator(
      createMockJob(),
      mockConfig,
      {
        es: mockEsClient,
        data: mockDataClient,
        uiSettings: uiSettingsClient,
      },
      new CancellationToken(),
      mockLogger,
      stream
    );
    const csvResult = await generateCsv.generateData();
    expect(content).toMatchInlineSnapshot(`
      "date,ip,message,\\"geo.coordinates\\"
      \\"2020-12-31T00:14:28.000Z\\",\\"110.135.176.89\\",\\"This is a great message!\\",
      "
    `);
    expect(csvResult.csv_contains_formulas).toBe(false);
  });

  it('calculates the bytes of the content', async () => {
    mockSearchResponse({
      columns: [{ name: 'message', type: 'string' }],
      values: Array(100).fill(['This is a great message!']),
    });

    const generateCsv = new CsvESQLGenerator(
      createMockJob(),
      mockConfig,
      {
        es: mockEsClient,
        data: mockDataClient,
        uiSettings: uiSettingsClient,
      },
      new CancellationToken(),
      mockLogger,
      stream
    );
    const csvResult = await generateCsv.generateData();
    expect(csvResult.max_size_reached).toBe(false);
    expect(csvResult.warnings).toEqual([]);
  });

  it('warns if max size was reached', async () => {
    const TEST_MAX_SIZE = 50;
    mockConfig = {
      ...mockConfig,
      maxSizeBytes: TEST_MAX_SIZE,
    };

    mockSearchResponse({
      columns: [{ name: 'message', type: 'string' }],
      values: Array(100).fill(['This is a great message!']),
    });

    const generateCsv = new CsvESQLGenerator(
      createMockJob(),
      mockConfig,
      {
        es: mockEsClient,
        data: mockDataClient,
        uiSettings: uiSettingsClient,
      },
      new CancellationToken(),
      mockLogger,
      stream
    );
    const csvResult = await generateCsv.generateData();
    expect(csvResult.max_size_reached).toBe(true);
    expect(csvResult.warnings).toEqual([]);
    expect(content).toMatchInlineSnapshot(`
      "message
      \\"This is a great message!\\"
      "
    `);
  });

  describe('jobParams', () => {
    it('uses columns to select columns', async () => {
      mockSearchResponse({
        columns: [
          { name: 'date', type: 'date' },
          { name: 'ip', type: 'ip' },
          { name: 'message', type: 'string' },
        ],
        values: [['2020-12-31T00:14:28.000Z', '110.135.176.89', 'This is a great message!']],
      });

      const generateCsv = new CsvESQLGenerator(
        createMockJob({ columns: ['message', 'date', 'something else'] }),
        mockConfig,
        {
          es: mockEsClient,
          data: mockDataClient,
          uiSettings: uiSettingsClient,
        },
        new CancellationToken(),
        mockLogger,
        stream
      );
      await generateCsv.generateData();

      expect(content).toMatchInlineSnapshot(`
        "message,date
        \\"This is a great message!\\",\\"2020-12-31T00:14:28.000Z\\"
        "
      `);
    });

    it('passes filters to the query', async () => {
      const query = { esql: 'from kibana_sample_data_logs | limit 10' };
      const filters = [
        {
          meta: {},
          query: {
            range: {
              '@timestamp': { format: 'strict_date_optional_time', gte: 'now-15m', lte: 'now' },
            },
          },
        },
      ];

      const generateCsv = new CsvESQLGenerator(
        createMockJob({ query, filters }),
        mockConfig,
        {
          es: mockEsClient,
          data: mockDataClient,
          uiSettings: uiSettingsClient,
        },
        new CancellationToken(),
        mockLogger,
        stream
      );
      await generateCsv.generateData();

      expect(mockDataClient.search).toHaveBeenCalledWith(
        {
          params: {
            filter: {
              bool: {
                filter: [
                  {
                    range: {
                      '@timestamp': {
                        format: 'strict_date_optional_time',
                        gte: 'now-15m',
                        lte: 'now',
                      },
                    },
                  },
                ],
                must: [],
                must_not: [],
                should: [],
              },
            },
            locale: 'en',
            query: '',
          },
        },
        {
          strategy: 'esql',
          transport: {
            requestTimeout: '30s',
          },
          abortSignal: expect.any(AbortSignal),
        }
      );
    });
  });

  describe('formulas', () => {
    const TEST_FORMULA = '=SUM(A1:A2)';

    it(`escapes formula values in a cell, doesn't warn the csv contains formulas`, async () => {
      mockSearchResponse({
        columns: [{ name: 'message', type: 'string' }],
        values: [[TEST_FORMULA]],
      });

      const generateCsv = new CsvESQLGenerator(
        createMockJob(),
        mockConfig,
        {
          es: mockEsClient,
          data: mockDataClient,
          uiSettings: uiSettingsClient,
        },
        new CancellationToken(),
        mockLogger,
        stream
      );

      const csvResult = await generateCsv.generateData();

      expect(content).toMatchInlineSnapshot(`
        "message
        \\"'=SUM(A1:A2)\\"
        "
      `);
      expect(csvResult.csv_contains_formulas).toBe(false);
    });

    it(`escapes formula values in a header, doesn't warn the csv contains formulas`, async () => {
      mockSearchResponse({
        columns: [{ name: TEST_FORMULA, type: 'string' }],
        values: [['This is great data']],
      });

      const generateCsv = new CsvESQLGenerator(
        createMockJob(),
        mockConfig,
        {
          es: mockEsClient,
          data: mockDataClient,
          uiSettings: uiSettingsClient,
        },
        new CancellationToken(),
        mockLogger,
        stream
      );

      const csvResult = await generateCsv.generateData();

      expect(content).toMatchInlineSnapshot(`
        "\\"'=SUM(A1:A2)\\"
        \\"This is great data\\"
        "
      `);
      expect(csvResult.csv_contains_formulas).toBe(false);
    });

    it('can check for formulas, without escaping them', async () => {
      mockConfig = {
        checkForFormulas: true,
        escapeFormulaValues: false,
        maxSizeBytes: 180000,
        useByteOrderMarkEncoding: false,
        scroll: { size: 500, duration: '30s', strategy: 'pit' },
        enablePanelActionDownload: true,
        maxConcurrentShardRequests: 5,
      };
      mockSearchResponse({
        columns: [{ name: 'message', type: 'string' }],
        values: [[TEST_FORMULA]],
      });

      const generateCsv = new CsvESQLGenerator(
        createMockJob(),
        mockConfig,
        {
          es: mockEsClient,
          data: mockDataClient,
          uiSettings: uiSettingsClient,
        },
        new CancellationToken(),
        mockLogger,
        stream
      );

      const csvResult = await generateCsv.generateData();

      expect(content).toMatchInlineSnapshot(`
        "message
        \\"=SUM(A1:A2)\\"
        "
      `);
      expect(csvResult.csv_contains_formulas).toBe(true);
    });
  });

  it('handles unknown errors', async () => {
    mockDataClient.search = jest.fn().mockImplementation(() => {
      throw new Error('An unknown error');
    });
    const generateCsv = new CsvESQLGenerator(
      createMockJob(),
      mockConfig,
      {
        es: mockEsClient,
        data: mockDataClient,
        uiSettings: uiSettingsClient,
      },
      new CancellationToken(),
      mockLogger,
      stream
    );
    await expect(generateCsv.generateData()).resolves.toMatchInlineSnapshot(`
      Object {
        "content_type": "text/csv",
        "csv_contains_formulas": false,
        "error_code": undefined,
        "max_size_reached": false,
        "metrics": Object {
          "csv": Object {
            "rows": 0,
          },
        },
        "warnings": Array [
          "Encountered an unknown error: An unknown error",
        ],
      }
    `);
  });

  describe('error codes', () => {
    it('returns the expected error code when authentication expires', async () => {
      mockDataClient.search = jest.fn().mockImplementation(() => {
        throw new esErrors.ResponseError({ statusCode: 403, meta: {} as any, warnings: [] });
      });

      const generateCsv = new CsvESQLGenerator(
        createMockJob(),
        mockConfig,
        {
          es: mockEsClient,
          data: mockDataClient,
          uiSettings: uiSettingsClient,
        },
        new CancellationToken(),
        mockLogger,
        stream
      );

      const { error_code: errorCode, warnings } = await generateCsv.generateData();
      expect(errorCode).toBe('authentication_expired_error');
      expect(warnings).toMatchInlineSnapshot(`
        Array [
          "This report contains partial CSV results because the authentication token expired. Export a smaller amount of data or increase the timeout of the authentication token.",
        ]
      `);

      expect(mockLogger.error.mock.calls).toMatchInlineSnapshot(`
        Array [
          Array [
            [ResponseError: Response Error],
          ],
        ]
      `);
    });
  });
});
