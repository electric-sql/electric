---
title: Literature
description: >-
  ElectricSQL builds on decades of research into local-first software and distributed databases.
---

import literature from '@site/data/literature.json'

The [ElectricSQL system](../index.md) builds on decades of research into local-first software and distributed database consistency, integrity and performance. In many cases, this research has been authored by [ElectricSQL's team and advisors](/about/team).

## Research papers

This page lists a non-exhaustive selection of papers that chart the development of some of the key concepts and algorithms that ElectricSQL is based on.

<div className="table-responsive my-6">
  <table className="table table-lg">
    <thead>
      <tr className="">
        <th scope="col" style={{minWidth: '40px'}}>
          Year
        </th>
        <th scope="col" style={{minWidth: '40%'}}>
          Paper
        </th>
        <th scope="col">
          Authors
        </th>
      </tr>
    </thead>
    <tbody>
      {literature.map((paper, i) => (
        <tr key={i}>
          <td>
            { paper.year }
          </td>
          <th scope="row">
            <a href={ paper.url } className="font-medium">
              { paper.title }
            </a>
          </th>
          <td>
            {paper.authors.map((name, j) => (
              <>
                { j === 0 ? '' : ', ' }
                { name }
              </>
            ))}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
