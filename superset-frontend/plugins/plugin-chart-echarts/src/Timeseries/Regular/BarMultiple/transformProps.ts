/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
/* eslint-disable camelcase */
import { invert } from 'lodash';
import {
  AnnotationLayer,
  AxisType,
  buildCustomFormatters,
  CategoricalColorNamespace,
  CurrencyFormatter,
  ensureIsArray,
  tooltipHtml,
  GenericDataType,
  getCustomFormatter,
  getMetricLabel,
  getNumberFormatter,
  getXAxisLabel,
  isDefined,
  isEventAnnotationLayer,
  isFormulaAnnotationLayer,
  isIntervalAnnotationLayer,
  isPhysicalColumn,
  isTimeseriesAnnotationLayer,
  t,
  TimeseriesDataRecord,
  NumberFormats,
} from '@superset-ui/core';
import {
  extractExtraMetrics,
  getOriginalSeries,
  isDerivedSeries,
} from '@superset-ui/chart-controls';
import type { EChartsCoreOption } from 'echarts/core';
import type { LineStyleOption } from 'echarts/types/src/util/types';
import type { SeriesOption } from 'echarts';
import {
  EchartsTimeseriesChartProps,
  EchartsTimeseriesFormData,
  OrientationType,
  TimeseriesChartTransformedProps,
} from '../../types';
import { DEFAULT_FORM_DATA } from '../../constants';
import { ForecastSeriesEnum, ForecastValue, Refs } from '../../../types';
import { parseAxisBound } from '../../../utils/controls';
import {
  calculateLowerLogTick,
  dedupSeries,
  extractDataTotalValues,
  extractSeries,
  extractShowValueIndexes,
  extractTooltipKeys,
  getAxisType,
  getColtypesMapping,
  getLegendProps,
  getMinAndMaxFromBounds,
} from '../../../utils/series';
import {
  extractAnnotationLabels,
  getAnnotationData,
} from '../../../utils/annotation';
import {
  extractForecastSeriesContext,
  extractForecastSeriesContexts,
  extractForecastValuesFromTooltipParams,
  formatForecastTooltipSeries,
  rebaseForecastDatum,
  reorderForecastSeries,
} from '../../../utils/forecast';
import { convertInteger } from '../../../utils/convertInteger';
import { defaultGrid, defaultYAxis } from '../../../defaults';
import {
  getBaselineSeriesForStream,
  getPadding,
  transformEventAnnotation,
  transformFormulaAnnotation,
  transformIntervalAnnotation,
  transformSeries,
  transformTimeseriesAnnotation,
} from '../../transformers';
import {
  OpacityEnum,
  StackControlsValue,
  TIMEGRAIN_TO_TIMESTAMP,
  TIMESERIES_CONSTANTS,
} from '../../../constants';
import { getDefaultTooltip } from '../../../utils/tooltip';
import {
  getPercentFormatter,
  getTooltipTimeFormatter,
  getXAxisFormatter,
  getYAxisFormatter,
} from '../../../utils/formatters';

export default function transformProps(
  chartProps: EchartsTimeseriesChartProps,
): TimeseriesChartTransformedProps {
  const {
    width,
    height,
    filterState,
    legendState,
    formData,
    hooks,
    queriesData,
    datasource,
    theme,
    inContextMenu,
    emitCrossFilters,
    legendIndex,
  } = chartProps;

  let focusedSeries: string | null = null;

  const {
    verboseMap = {},
    columnFormats = {},
    currencyFormats = {},
  } = datasource;
  const [firstQueryData] = queriesData;
  const dataTypes = getColtypesMapping(firstQueryData);
  const annotationData = getAnnotationData(chartProps);

  const {
    area,
    annotationLayers,
    colorScheme,
    contributionMode,
    forecastEnabled,
    groupby,
    legendOrientation,
    legendType,
    legendMargin,
    logAxis,
    markerEnabled,
    markerSize,
    /**
     * metrics: [{metrics: [{ value: 'metric1', label: 'metric1' }, { value: 'metric2', label: 'metric2' }, { value: 'metric3', label: 'metric3' }]}, {metrics: [{ value: 'metric4', label: 'metric4' }, { value: 'metric5', label: 'metric5' }, { value: 'metric6', label: 'metric6' }}]}]
     */
    metrics,
    minorSplitLine,
    minorTicks,
    onlyTotal,
    opacity,
    orientation,
    percentageThreshold,
    richTooltip,
    seriesType,
    showLegend,
    showValue,
    sliceId,
    sortSeriesType,
    sortSeriesAscending,
    timeGrainSqla,
    timeCompare,
    timeShiftColor,
    stack,
    tooltipTimeFormat,
    tooltipSortByMetric,
    showTooltipTotal,
    showTooltipPercentage,
    truncateXAxis,
    truncateYAxis,
    xAxis: xAxisOrig,
    xAxisBounds,
    xAxisForceCategorical,
    xAxisLabelRotation,
    xAxisSortSeries,
    xAxisSortSeriesAscending,
    xAxisTimeFormat,
    xAxisTitle,
    xAxisTitleMargin,
    yAxisBounds,
    yAxisFormat,
    currencyFormat,
    yAxisTitle,
    yAxisTitleMargin,
    yAxisTitlePosition,
    zoomable,
  }: EchartsTimeseriesFormData = { ...DEFAULT_FORM_DATA, ...formData };
  const refs: Refs = {};
  const groupBy = ensureIsArray(groupby);
  const labelMapArray: { [key: string]: string[] }[] = queriesData.map(
    queryData =>
      Object.entries(
        (queryData as any).label_map as { [key: string]: string[] },
      ).reduce((acc, entry) => {
        if (
          entry[1].length > groupBy.length &&
          Array.isArray(timeCompare) &&
          timeCompare.includes(entry[1][0])
        ) {
          entry[1].shift();
        }
        return { ...acc, [entry[0]]: entry[1] };
      }, {}),
  );

  const colorScale = CategoricalColorNamespace.getScale(colorScheme as string);
  const rebasedDataArray = queriesData.map(queryData =>
    rebaseForecastDatum(queryData.data as TimeseriesDataRecord[], verboseMap),
  );
  const xAxisLabelArray = metrics.map(metricCollection => {
    const xAxisLabel = getXAxisLabel({
      ...chartProps.rawFormData,
      metrics: metricCollection.metrics,
    }) as string;
    if (
      isPhysicalColumn(chartProps.rawFormData?.x_axis) &&
      isDefined(verboseMap[xAxisLabel])
    ) {
      return verboseMap[xAxisLabel];
    }
    return xAxisLabel;
  });

  const isHorizontal = orientation === OrientationType.Horizontal;

  // axis bounds need to be parsed to replace incompatible values with undefined
  const [xAxisMin, xAxisMax] = (xAxisBounds || []).map(parseAxisBound);
  let [yAxisMin, yAxisMax] = (yAxisBounds || []).map(parseAxisBound);

  const totalStackedValuesArray: any[] = [];
  const thresholdValuesArray: any[] = [];
  queriesData.forEach((queryData, index) => {
    const { totalStackedValues, thresholdValues } = extractDataTotalValues(
      rebasedDataArray[index],
      {
        stack,
        percentageThreshold,
        xAxisCol: xAxisLabelArray[index],
        legendState,
      },
    );
    totalStackedValuesArray.push(totalStackedValues);
    thresholdValuesArray.push(thresholdValues);
  });
  const extraMetricLabelsArray = metrics.map(({ metrics }) =>
    extractExtraMetrics({ ...chartProps.rawFormData, metrics }).map(
      getMetricLabel,
    ),
  );

  const isMultiSeriesArray = metrics.map(
    ({ metrics }) => groupBy.length || metrics?.length > 1,
  );

  // Initialize arrays to collect data from all queries
  const allSeries: SeriesOption[] = [];
  const allRawSeries: any[] = [];
  const allXAxes: any[] = [];
  const allYAxes: any[] = [];
  const allGrids: any[] = [];
  let allMinPositiveValue: number | undefined;
  let finalXAxisType: string | undefined;
  let finalXAxisDataType: GenericDataType | undefined;
  let finalXAxisLabel: string | undefined;

  rebasedDataArray.forEach((rebasedData, index) => {
    const [rawSeries, sortedTotalValues, minPositiveValue] = extractSeries(
      rebasedData,
      {
        fillNeighborValue: stack && !forecastEnabled ? 0 : undefined,
        xAxis: xAxisLabelArray[index],
        extraMetricLabels: extraMetricLabelsArray[index],
        stack,
        totalStackedValues: totalStackedValuesArray[index],
        isHorizontal,
        sortSeriesType,
        sortSeriesAscending,
        xAxisSortSeries: isMultiSeriesArray[index]
          ? xAxisSortSeries
          : undefined,
        xAxisSortSeriesAscending: isMultiSeriesArray[index]
          ? xAxisSortSeriesAscending
          : undefined,
      },
    );
    const showValueIndexes = extractShowValueIndexes(rawSeries, {
      stack,
      onlyTotal,
      isHorizontal,
      legendState,
    });

    const seriesContexts = extractForecastSeriesContexts(
      rawSeries.map(series => series.name as string),
    );
    const isAreaExpand = stack === StackControlsValue.Expand;
    // const xAxisDataType = dataTypes?.[xAxisLabelArray[index]] ?? dataTypes?.[xAxisOrig];

    // const xAxisType = getAxisType(stack, xAxisForceCategorical, xAxisDataType);
    const series: SeriesOption[] = [];

    const forcePercentFormatter = Boolean(contributionMode || isAreaExpand);
    const percentFormatter = forcePercentFormatter
      ? getPercentFormatter(yAxisFormat)
      : getPercentFormatter(NumberFormats.PERCENT_2_POINT);
    const defaultFormatter = currencyFormat?.symbol
      ? new CurrencyFormatter({
          d3Format: yAxisFormat,
          currency: currencyFormat,
        })
      : getNumberFormatter(yAxisFormat);
    const customFormatters = buildCustomFormatters(
      metrics,
      currencyFormats,
      columnFormats,
      yAxisFormat,
      currencyFormat,
    );

    const array = ensureIsArray(chartProps.rawFormData?.time_compare);
    const inverted = invert(verboseMap);

    let patternIncrement = 0;

    // Store values for later use
    allRawSeries.push(...rawSeries);
    if (minPositiveValue !== undefined) {
      allMinPositiveValue = allMinPositiveValue
        ? Math.min(allMinPositiveValue, minPositiveValue)
        : minPositiveValue;
    }

    // Use the first query's axis settings as default
    if (index === 0) {
      finalXAxisLabel = xAxisLabelArray[index];
      finalXAxisDataType =
        dataTypes?.[xAxisLabelArray[index]] ?? dataTypes?.[xAxisOrig];
      finalXAxisType = getAxisType(
        stack,
        xAxisForceCategorical,
        finalXAxisDataType,
      );
    }

    rawSeries.forEach(entry => {
      const derivedSeries = isDerivedSeries(entry, chartProps.rawFormData);
      const lineStyle: LineStyleOption = {};
      if (derivedSeries) {
        patternIncrement += 1;
        // use a combination of dash and dot for the line style
        lineStyle.type = [
          (patternIncrement % 5) + 1,
          (patternIncrement % 3) + 1,
        ];
        lineStyle.opacity = OpacityEnum.DerivedSeries;
      }

      const entryName = String(entry.name || '');
      const seriesName = inverted[entryName] || entryName;
      const colorScaleKey = getOriginalSeries(seriesName, array);

      const transformedSeries = transformSeries(
        entry,
        colorScale,
        colorScaleKey,
        {
          area,
          connectNulls: derivedSeries,
          filterState,
          seriesContexts,
          markerEnabled,
          markerSize,
          areaOpacity: opacity,
          seriesType,
          legendState,
          stack,
          stackIdSuffix: metrics.length > 1 ? `_grid_${index}` : undefined, // Unique stack suffix for each grid
          formatter: forcePercentFormatter
            ? percentFormatter
            : (getCustomFormatter(
                customFormatters,
                metrics,
                (labelMapArray[index] as any)?.[seriesName]?.[0],
              ) ?? defaultFormatter),
          showValue,
          onlyTotal,
          totalStackedValues: sortedTotalValues,
          showValueIndexes,
          thresholdValues: thresholdValuesArray[index],
          richTooltip,
          sliceId,
          isHorizontal,
          lineStyle,
          timeCompare: array,
          timeShiftColor,
        },
      );
      if (transformedSeries) {
        if (stack === StackControlsValue.Stream) {
          // bug in Echarts - `stackStrategy: 'all'` doesn't work with nulls, so we cast them to 0
          series.push({
            ...transformedSeries,
            data: (transformedSeries.data as any).map(
              (row: [string | number, number]) => [row[0], row[1] ?? 0],
            ),
          });
        } else {
          series.push(transformedSeries);
        }
      }
    });
    if (stack === StackControlsValue.Stream) {
      const baselineSeries = getBaselineSeriesForStream(
        series.map(entry => entry.data) as [string | number, number][][],
        seriesType,
      );

      series.unshift(baselineSeries);
    }

    // Create grid layout for each metric collection
    const gridHeight = 100 / metrics.length; // Divide height equally
    const gridTop = index * gridHeight;

    const currentGrid = {
      left: '10%',
      right: '10%',
      top: `${gridTop}%`,
      height: `${gridHeight - 5}%`, // Leave some space between grids
    };

    allGrids.push(currentGrid);

    // Create axes for this grid
    const currentXAxis = {
      gridIndex: index,
      type:
        finalXAxisType ||
        getAxisType(stack, xAxisForceCategorical, finalXAxisDataType),
      name: xAxisTitle,
      nameGap: convertInteger(xAxisTitleMargin),
      nameLocation: 'middle',
      axisLabel: {
        hideOverlap: true,
        formatter:
          finalXAxisDataType === GenericDataType.Temporal
            ? getXAxisFormatter(xAxisTimeFormat)
            : String,
        rotate: xAxisLabelRotation,
      },
      minorTick: { show: minorTicks },
      minInterval:
        (finalXAxisType ||
          getAxisType(stack, xAxisForceCategorical, finalXAxisDataType)) ===
          AxisType.Time && timeGrainSqla
          ? TIMEGRAIN_TO_TIMESTAMP[
              timeGrainSqla as keyof typeof TIMEGRAIN_TO_TIMESTAMP
            ]
          : 0,
      ...getMinAndMaxFromBounds(
        (finalXAxisType ||
          getAxisType(
            stack,
            xAxisForceCategorical,
            finalXAxisDataType,
          )) as AxisType,
        truncateXAxis,
        xAxisMin,
        xAxisMax,
        seriesType,
      ),
    };

    const currentYAxis = {
      ...defaultYAxis,
      gridIndex: index,
      type: logAxis ? AxisType.Log : AxisType.Value,
      min: yAxisMin,
      max: yAxisMax,
      minorTick: { show: minorTicks },
      minorSplitLine: { show: minorSplitLine },
      axisLabel: {
        formatter: getYAxisFormatter(
          metrics,
          Boolean(contributionMode || isAreaExpand),
          buildCustomFormatters(
            metrics,
            currencyFormats,
            columnFormats,
            yAxisFormat,
            currencyFormat,
          ),
          currencyFormat?.symbol
            ? new CurrencyFormatter({
                d3Format: yAxisFormat,
                currency: currencyFormat,
              })
            : getNumberFormatter(yAxisFormat),
          yAxisFormat,
        ),
      },
      scale: truncateYAxis,
      name: yAxisTitle,
      nameGap: convertInteger(yAxisTitleMargin),
      nameLocation: yAxisTitlePosition === 'Left' ? 'middle' : 'end',
    };

    allXAxes.push(currentXAxis);
    allYAxes.push(currentYAxis);

    // Add axis indices to series
    const seriesWithAxisIndices = series.map(s => ({
      ...s,
      xAxisIndex: isHorizontal ? index : index,
      yAxisIndex: isHorizontal ? index : index,
    }));

    // Add series from this query to the overall collection
    allSeries.push(...seriesWithAxisIndices);
  });

  const selectedValues = (filterState.selectedValues || []).reduce(
    (acc: Record<string, number>, selectedValue: string) => {
      const index = allSeries.findIndex(({ name }) => name === selectedValue);
      return {
        ...acc,
        [index]: selectedValue,
      };
    },
    {},
  );

  // default to 0-100% range when doing row-level contribution chart
  const isAreaExpand = stack === StackControlsValue.Expand;
  if ((contributionMode === 'row' || isAreaExpand) && stack) {
    if (yAxisMin === undefined) yAxisMin = 0;
    if (yAxisMax === undefined) yAxisMax = 1;
  } else if (
    logAxis &&
    yAxisMin === undefined &&
    allMinPositiveValue !== undefined
  ) {
    yAxisMin = calculateLowerLogTick(allMinPositiveValue);
  }

  // Handle annotations - use first query's data for annotations
  const firstRebasedData = rebasedDataArray[0];

  annotationLayers
    .filter((layer: AnnotationLayer) => layer.show)
    .forEach((layer: AnnotationLayer) => {
      if (isFormulaAnnotationLayer(layer))
        allSeries.push(
          transformFormulaAnnotation(
            layer,
            firstRebasedData as TimeseriesDataRecord[],
            finalXAxisLabel!,
            finalXAxisType as AxisType,
            colorScale,
            sliceId,
            orientation,
          ),
        );
      else if (isIntervalAnnotationLayer(layer)) {
        allSeries.push(
          ...transformIntervalAnnotation(
            layer,
            firstRebasedData as TimeseriesDataRecord[],
            annotationData,
            colorScale,
            theme,
            sliceId,
            orientation,
          ),
        );
      } else if (isEventAnnotationLayer(layer)) {
        allSeries.push(
          ...transformEventAnnotation(
            layer,
            firstRebasedData as TimeseriesDataRecord[],
            annotationData,
            colorScale,
            theme,
            sliceId,
            orientation,
          ),
        );
      } else if (isTimeseriesAnnotationLayer(layer)) {
        allSeries.push(
          ...transformTimeseriesAnnotation(
            layer,
            markerSize,
            firstRebasedData as TimeseriesDataRecord[],
            annotationData,
            colorScale,
            sliceId,
            orientation,
          ),
        );
      }
    });

  const tooltipFormatter =
    finalXAxisDataType === GenericDataType.Temporal
      ? getTooltipTimeFormatter(tooltipTimeFormat)
      : String;
  const xAxisFormatter =
    finalXAxisDataType === GenericDataType.Temporal
      ? getXAxisFormatter(xAxisTimeFormat)
      : String;

  const {
    setDataMask = () => {},
    setControlValue = () => {},
    onContextMenu,
    onLegendStateChanged,
    onLegendScroll,
  } = hooks;

  const addYAxisLabelOffset = !!yAxisTitle;
  const addXAxisLabelOffset = !!xAxisTitle;
  const padding = getPadding(
    showLegend,
    legendOrientation,
    addYAxisLabelOffset,
    zoomable,
    legendMargin,
    addXAxisLabelOffset,
    yAxisTitlePosition,
    convertInteger(yAxisTitleMargin),
    convertInteger(xAxisTitleMargin),
    isHorizontal,
  );

  const legendData = allRawSeries
    .filter(
      entry =>
        extractForecastSeriesContext(entry.name || '').type ===
        ForecastSeriesEnum.Observation,
    )
    .map(entry => entry.name || '')
    .concat(extractAnnotationLabels(annotationLayers, annotationData));

  // Handle horizontal orientation by swapping axes
  let finalXAxes = allXAxes;
  let finalYAxes = allYAxes;

  if (isHorizontal) {
    finalXAxes = allYAxes.map(axis => ({ ...axis, type: axis.type }));
    finalYAxes = allXAxes.map(axis => ({ ...axis, type: axis.type }));

    // Update grid padding for horizontal orientation
    allGrids.forEach((grid, idx) => {
      const updatedGrid = { ...grid };
      updatedGrid.bottom = grid.left || '10%';
      updatedGrid.left = grid.bottom || '10%';
      allGrids[idx] = updatedGrid;
    });
  }

  const echartOptions: EChartsCoreOption = {
    useUTC: true,
    grid:
      allGrids.length > 1
        ? allGrids
        : {
            ...defaultGrid,
            ...padding,
          },
    xAxis:
      allGrids.length > 1
        ? finalXAxes
        : finalXAxes[0] || {
            type: AxisType.Category,
            name: xAxisTitle,
          },
    yAxis:
      allGrids.length > 1
        ? finalYAxes
        : finalYAxes[0] || {
            type: logAxis ? AxisType.Log : AxisType.Value,
            name: yAxisTitle,
          },
    tooltip: {
      ...getDefaultTooltip(refs),
      show: !inContextMenu,
      trigger: richTooltip ? 'axis' : 'item',
      formatter: (params: any) => {
        const [xIndex, yIndex] = isHorizontal ? [1, 0] : [0, 1];
        const xValue: number = richTooltip
          ? params[0].value[xIndex]
          : params.value[xIndex];
        const forecastValue: any[] = richTooltip ? params : [params];
        const sortedKeys = extractTooltipKeys(
          forecastValue,
          yIndex,
          richTooltip,
          tooltipSortByMetric,
        );
        const forecastValues: Record<string, ForecastValue> =
          extractForecastValuesFromTooltipParams(forecastValue, isHorizontal);

        const isForecast = Object.values(forecastValues).some(
          value =>
            value.forecastTrend || value.forecastLower || value.forecastUpper,
        );

        const formatter =
          contributionMode || isAreaExpand
            ? getPercentFormatter(yAxisFormat)
            : (getCustomFormatter(
                buildCustomFormatters(
                  metrics,
                  currencyFormats,
                  columnFormats,
                  yAxisFormat,
                  currencyFormat,
                ),
                metrics,
              ) ??
              (currencyFormat?.symbol
                ? new CurrencyFormatter({
                    d3Format: yAxisFormat,
                    currency: currencyFormat,
                  })
                : getNumberFormatter(yAxisFormat)));

        const rows: string[][] = [];
        const total = Object.values(forecastValues).reduce(
          (acc, value) =>
            value.observation !== undefined ? acc + value.observation : acc,
          0,
        );
        const isMultiSeries = isMultiSeriesArray.some(Boolean);
        const allowTotal = Boolean(isMultiSeries) && richTooltip && !isForecast;
        const showPercentage =
          allowTotal &&
          !(contributionMode || isAreaExpand) &&
          showTooltipPercentage;
        const keys = Object.keys(forecastValues);
        let focusedRow;
        sortedKeys
          .filter(key => keys.includes(key))
          .forEach(key => {
            const value = forecastValues[key];
            if (value.observation === 0 && stack) {
              return;
            }
            const row = formatForecastTooltipSeries({
              ...value,
              seriesName: key,
              formatter,
            });
            if (showPercentage && value.observation !== undefined) {
              row.push(
                getPercentFormatter(NumberFormats.PERCENT_2_POINT).format(
                  value.observation / (total || 1),
                ),
              );
            }
            rows.push(row);
            if (key === focusedSeries) {
              focusedRow = rows.length - 1;
            }
          });
        if (stack) {
          rows.reverse();
          if (focusedRow !== undefined) {
            focusedRow = rows.length - focusedRow - 1;
          }
        }
        if (allowTotal && showTooltipTotal) {
          const totalRow = ['Total', formatter.format(total)];
          if (showPercentage) {
            totalRow.push(
              getPercentFormatter(NumberFormats.PERCENT_2_POINT).format(1),
            );
          }
          rows.push(totalRow);
        }
        return tooltipHtml(rows, tooltipFormatter(xValue), focusedRow);
      },
    },
    legend: {
      ...getLegendProps(
        legendType,
        legendOrientation,
        showLegend,
        theme,
        zoomable,
        legendState,
        padding,
      ),
      scrollDataIndex: legendIndex || 0,
      data: legendData as string[],
    },
    series: dedupSeries(reorderForecastSeries(allSeries) as SeriesOption[]),
    toolbox: {
      show: zoomable,
      top: TIMESERIES_CONSTANTS.toolboxTop,
      right: TIMESERIES_CONSTANTS.toolboxRight,
      feature: {
        dataZoom: {
          ...(stack ? { yAxisIndex: false } : {}), // disable y-axis zoom for stacked charts
          title: {
            zoom: t('zoom area'),
            back: t('restore zoom'),
          },
        },
      },
    },
    dataZoom: zoomable
      ? [
          {
            type: 'slider',
            start: TIMESERIES_CONSTANTS.dataZoomStart,
            end: TIMESERIES_CONSTANTS.dataZoomEnd,
            bottom: TIMESERIES_CONSTANTS.zoomBottom,
            yAxisIndex: isHorizontal
              ? Array.from({ length: allGrids.length }, (_, i) => i)
              : undefined,
            xAxisIndex: !isHorizontal
              ? Array.from({ length: allGrids.length }, (_, i) => i)
              : undefined,
          },
          ...allGrids.map((_, index) => ({
            type: 'inside' as const,
            yAxisIndex: index,
            xAxisIndex: index,
            zoomOnMouseWheel: false,
            moveOnMouseWheel: true,
          })),
        ]
      : [],
  };

  const onFocusedSeries = (seriesName: string | null) => {
    focusedSeries = seriesName;
  };

  return {
    echartOptions,
    emitCrossFilters,
    formData,
    groupby: groupBy,
    height,
    labelMap: labelMapArray[0] || {},
    selectedValues,
    setDataMask,
    setControlValue,
    width,
    legendData,
    onContextMenu,
    onLegendStateChanged,
    onFocusedSeries,
    xValueFormatter: tooltipFormatter,
    xAxis: {
      label: finalXAxisLabel || '',
      type: (finalXAxisType as AxisType) || AxisType.Category,
    },
    refs,
    coltypeMapping: dataTypes,
    onLegendScroll,
  };
}
