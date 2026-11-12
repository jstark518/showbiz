import { SlidePlaceholder } from '../../../web/src/sign/slides/SlidePlaceholder';
import { NAV_ICON_PROPS, type SignPlugin } from '../../web/types';
import type { DataTable, DataTableSlideConfig } from '../shared';
import './sign.css';

interface Props {
  config: DataTableSlideConfig;
  table: DataTable | undefined;
  title: string;
}

function DataTableSlide({ config, table, title }: Props) {
  // Both of these are ordinary states, not faults: a slide is created before a
  // table is chosen, and a table can be deleted while a slide still names it.
  // Saying which one it is in plain language is the whole job of the
  // placeholder — someone walking past the sign has to be able to fix it.
  if (!config.tableId) {
    return (
      <SlidePlaceholder
        heading={config.heading || title || 'Table'}
        detail="No table chosen yet. Pick one in the control panel."
      />
    );
  }
  if (!table) {
    return (
      <SlidePlaceholder
        heading={config.heading || title || 'Table'}
        detail="That table has been deleted. Choose another in the control panel."
      />
    );
  }

  const columns = table.columns;
  const rows = table.rows.slice(0, config.maxRows);

  if (columns.length === 0 || rows.length === 0) {
    return (
      <SlidePlaceholder
        heading={config.heading || table.name || title}
        detail="This table has no rows yet. Add some in the control panel."
      />
    );
  }

  return (
    <div className="slide slide--table">
      <h1 className="table__heading">{config.heading || table.name || title}</h1>
      <div className="table__scroll">
        <table className={`table ${config.striped ? 'table--striped' : ''}`}>
          {config.showHeader ? (
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.id} className={`table__cell table__cell--${column.align}`}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td key={column.id} className={`table__cell table__cell--${column.align}`}>
                    {row.cells[column.id] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.rows.length > rows.length ? (
        <p className="table__more">
          + {table.rows.length - rows.length} more
        </p>
      ) : null}
    </div>
  );
}

export const dataTableSignPlugin: SignPlugin = {
  id: 'data-table',
  slides: {
    data_table: {
      nav: {
        label: 'Table',
        icon: (
          <svg {...NAV_ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18M3 14.5h18M9 9v11" />
          </svg>
        ),
      },
      render: ({ slide, data }) => {
        const config = slide.config as DataTableSlideConfig;
        return (
          <DataTableSlide
            config={config}
            table={data.tables.find((table) => table.id === config.tableId)}
            title={slide.title}
          />
        );
      },
    },
  },
};
