import PropTypes from 'prop-types';
import { forwardRef } from 'react';
import { DndMetricSelect } from 'src/explore/components/controls/DndColumnSelectControl/DndMetricSelect';

const propTypes = {
  onChange: PropTypes.func.isRequired,
  key: PropTypes.string,
  metrics: PropTypes.array,
  datasource: PropTypes.object,
  savedMetrics: PropTypes.array,
  columns: PropTypes.array,
};

const defaultProps = {
  metrics: [],
  datasource: null,
  savedMetrics: [],
  columns: [],
};

// Use React.forwardRef for compatibility with react-sortable-hoc
const MetricCollectionItem = forwardRef(
  (
    props: PropTypes.InferProps<typeof propTypes>,
    ref: React.RefObject<HTMLDivElement>,
  ) => {
    const {
      onChange,
      metrics = [],
      datasource,
      savedMetrics,
      columns,
      key,
      ...restProps
    } = props;

    const handleMetricsChange = (
      newMetrics: PropTypes.InferProps<typeof propTypes>['metrics'],
    ) => {
      onChange({
        key,
        metrics: newMetrics || [],
      });
    };

    return (
      <div ref={ref as React.RefObject<HTMLDivElement>}>
        <DndMetricSelect
          {...restProps}
          multi
          value={metrics}
          onChange={handleMetricsChange}
          datasource={datasource}
          savedMetrics={savedMetrics}
          columns={columns}
        />
      </div>
    );
  },
);

MetricCollectionItem.propTypes = propTypes;
MetricCollectionItem.defaultProps = defaultProps;
MetricCollectionItem.displayName = 'MetricCollectionItem';

export default MetricCollectionItem;
